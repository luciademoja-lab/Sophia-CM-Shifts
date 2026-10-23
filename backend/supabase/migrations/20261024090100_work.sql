-- Shift reports: the kinds of work from the Vik 2.0 guide, posters with issues and
-- time spent on tasks. Weekly reports: from Sunday the RCM sends the week's reported
-- hours to the admins, who approve them (then the RCM logs them on Upwork).

alter table public.shift_reports
  add column work_types text[] not null default '{}'
    check (work_types <@ array['onboarding', 'accounts_check', 'poster_issues', 'community']),
  add column posters text not null default '' check (length(posters) <= 1000);

create table public.report_tasks (
  shift_id uuid not null references public.shift_reports (shift_id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  minutes int not null check (minutes between 1 and 1440),
  primary key (shift_id, task_id)
);
create index report_tasks_task_idx on public.report_tasks (task_id);
alter table public.report_tasks enable row level security;
revoke all on public.report_tasks from anon;
revoke insert, update, delete, truncate on public.report_tasks from authenticated;
create policy "admins see all task time, RCMs their own" on public.report_tasks for select to authenticated
  using (public.is_admin() or owner = auth.uid());

create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  week date not null check (extract(isodow from week) = 1),
  worked_minutes int not null,
  message text not null check (length(message) between 1 and 8000),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  unique (owner, week)
);
alter table public.weekly_reports enable row level security;
revoke all on public.weekly_reports from anon;
revoke insert, update, delete, truncate on public.weekly_reports from authenticated;
create policy "admins and viewers see all weekly reports, RCMs their own" on public.weekly_reports for select to authenticated
  using (public.sees_everything() or owner = auth.uid());

-- Monday of the week a moment falls in, in the person's time zone.
create function public._report_week(p_owner uuid, p_at timestamptz) returns date
language sql stable security definer set search_path = '' as $$
  select date_trunc('week', p_at at time zone coalesce((select timezone from public.profiles where id = p_owner), 'UTC'))::date
$$;

create function public._week_locked(me public.profiles, s public.shifts) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if me.role = 'rcm' and exists (
    select 1 from public.weekly_reports w
    where w.owner = s.owner and w.week = public._report_week(s.owner, s.starts_at) and w.status in ('submitted', 'approved')
  ) then raise exception 'RCM_INVALID: the weekly report for this week was already sent; ask an admin to change it'; end if;
end $$;

drop function public.save_report(uuid, int, text);
create function public.save_report(p_shift uuid, p_worked_minutes int, p_notes text, p_work_types text[], p_posters text, p_tasks jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  s public.shifts := public._manageable(p_shift, me);
  v_types text[] := coalesce(p_work_types, '{}');
  v_tasks jsonb := coalesce(p_tasks, '[]'::jsonb);
begin
  if s.status = 'covered' then raise exception 'RCM_INVALID: this shift was taken over; the cover shift gets the report'; end if;
  if s.status = 'pending' then raise exception 'RCM_INVALID: this shift is waiting for an admin to approve it'; end if;
  if s.starts_at > now() then raise exception 'RCM_INVALID: you can report on a shift once it has started'; end if;
  perform public._week_locked(me, s);
  if p_worked_minutes is null or p_worked_minutes < 0 or p_worked_minutes > 1440 then
    raise exception 'RCM_INVALID: worked hours must be between 0 and 24';
  end if;
  if not v_types <@ array['onboarding', 'accounts_check', 'poster_issues', 'community'] then
    raise exception 'RCM_INVALID: pick a kind of work from the list';
  end if;
  if jsonb_typeof(v_tasks) <> 'array' then raise exception 'RCM_INVALID: bad task list'; end if;
  if cardinality(v_types) = 0 and jsonb_array_length(v_tasks) = 0 then
    raise exception 'RCM_INVALID: tick at least one kind of work, or link a task';
  end if;
  if 'poster_issues' = any (v_types) and length(btrim(coalesce(p_posters, ''))) = 0 then
    raise exception 'RCM_INVALID: write the names of the posters who had issues';
  end if;
  if length(coalesce(p_notes, '')) > 4000 then raise exception 'RCM_INVALID: the report is too long'; end if;
  if length(coalesce(p_posters, '')) > 1000 then raise exception 'RCM_INVALID: the list of posters is too long'; end if;
  if exists (select 1 from jsonb_array_elements(v_tasks) t where coalesce((t ->> 'minutes')::int, 0) < 1) then
    raise exception 'RCM_INVALID: give each linked task some minutes';
  end if;
  if (select count(distinct t ->> 'task_id') from jsonb_array_elements(v_tasks) t) <> jsonb_array_length(v_tasks) then
    raise exception 'RCM_INVALID: the same task is linked twice';
  end if;
  if (select coalesce(sum((t ->> 'minutes')::int), 0) from jsonb_array_elements(v_tasks) t) > p_worked_minutes then
    raise exception 'RCM_INVALID: the time on tasks is more than the hours worked';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_tasks) t
    where not exists (select 1 from public.task_assignees a where a.task_id = (t ->> 'task_id')::uuid and a.person = s.owner)
  ) then raise exception 'RCM_INVALID: you can only link tasks assigned to the person who worked the shift'; end if;

  insert into public.shift_reports (shift_id, owner, worked_minutes, notes, work_types, posters, created_by, updated_by)
  values (s.id, s.owner, p_worked_minutes, btrim(coalesce(p_notes, '')), v_types,
    case when 'poster_issues' = any (v_types) then btrim(coalesce(p_posters, '')) else '' end, me.id, me.id)
  on conflict (shift_id) do update set
    owner = excluded.owner, worked_minutes = excluded.worked_minutes, notes = excluded.notes,
    work_types = excluded.work_types, posters = excluded.posters, updated_by = me.id, updated_at = now();
  delete from public.report_tasks where shift_id = s.id;
  insert into public.report_tasks (shift_id, task_id, owner, minutes)
  select s.id, (t ->> 'task_id')::uuid, s.owner, (t ->> 'minutes')::int from jsonb_array_elements(v_tasks) t;
  perform public._log(me.id, s.owner, 'reported', s.id, s.starts_at, s.ends_at);
end $$;

create or replace function public.delete_report(p_shift uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  s public.shifts := public._manageable(p_shift, me);
begin
  perform public._week_locked(me, s);
  delete from public.shift_reports where shift_id = s.id;
end $$;

-- The RCM sends (or sends again after a rejection) the week's report.
create function public.submit_weekly(p_week date, p_message text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  v_tz text;
  v_minutes int;
  w public.weekly_reports;
begin
  if me.role <> 'rcm' then raise exception 'RCM_FORBIDDEN: only RCMs send weekly reports'; end if;
  if p_week is null or extract(isodow from p_week) <> 1 then raise exception 'RCM_INVALID: pick the Monday of the week'; end if;
  v_tz := coalesce(me.timezone, 'UTC');
  if now() < ((p_week + 6)::timestamp at time zone v_tz) then
    raise exception 'RCM_INVALID: you can send the weekly report from Sunday';
  end if;
  if p_message is null or length(btrim(p_message)) = 0 or length(p_message) > 8000 then
    raise exception 'RCM_INVALID: write the weekly report (up to 8000 characters)';
  end if;
  select coalesce(sum(r.worked_minutes), 0) into v_minutes
  from public.shift_reports r join public.shifts s on s.id = r.shift_id
  where s.owner = me.id and s.status not in ('covered', 'pending') and public._report_week(me.id, s.starts_at) = p_week;

  select * into w from public.weekly_reports where owner = me.id and week = p_week for update;
  if found then
    if w.status = 'approved' then raise exception 'RCM_INVALID: this weekly report was already approved'; end if;
    update public.weekly_reports set worked_minutes = v_minutes, message = btrim(p_message), status = 'submitted',
      submitted_at = now(), decided_by = null, decided_at = null where id = w.id;
    return w.id;
  end if;
  insert into public.weekly_reports (owner, week, worked_minutes, message) values (me.id, p_week, v_minutes, btrim(p_message))
  returning id into w.id;
  return w.id;
end $$;

create function public._decide_weekly(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  w public.weekly_reports;
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins approve weekly reports'; end if;
  select * into w from public.weekly_reports where id = p_id for update;
  if not found then raise exception 'RCM_NOT_FOUND: that weekly report no longer exists'; end if;
  if w.status <> 'submitted' then raise exception 'RCM_INVALID: this weekly report is not waiting for approval'; end if;
  update public.weekly_reports set status = p_status, decided_by = me.id, decided_at = now() where id = p_id;
end $$;

create function public.approve_weekly(p_id uuid) returns void
language sql security definer set search_path = '' as $$ select public._decide_weekly(p_id, 'approved') $$;
create function public.reject_weekly(p_id uuid) returns void
language sql security definer set search_path = '' as $$ select public._decide_weekly(p_id, 'rejected') $$;

revoke execute on function public._report_week(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public._week_locked(public.profiles, public.shifts) from public, anon, authenticated;
revoke execute on function public._decide_weekly(uuid, text) from public, anon, authenticated;
revoke execute on function public.save_report(uuid, int, text, text[], text, jsonb) from public, anon;
revoke execute on function public.submit_weekly(date, text) from public, anon;
revoke execute on function public.approve_weekly(uuid) from public, anon;
revoke execute on function public.reject_weekly(uuid) from public, anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.report_tasks, public.weekly_reports;
  end if;
end $$;
