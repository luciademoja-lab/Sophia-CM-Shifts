-- Clocking in and out of shifts, and the to-do checklists admins write for them.
--
-- Sessions: an RCM starts a session during their own booked shift and ends it. After the
-- shift ends they are asked "Are you still working?" (check_due_at); each Yes moves the next
-- question 30 minutes later. With no answer for 30 minutes the session ends at the question
-- time (ended_by = 'timeout'), so the unanswered minutes are not counted.
--
-- To-do templates: a checklist for everyone or chosen people, repeating (every shift, or every
-- x hours/days/weeks/months from a start) or for one time slot. A specific template adds to
-- or replaces the every-shift one. Overlap rules are checked here too.

create table public.shift_sessions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check_due_at timestamptz not null,
  ended_by text check (ended_by in ('user', 'timeout'))
);
create unique index shift_sessions_one_open on public.shift_sessions (owner) where ended_at is null;
create index shift_sessions_shift_idx on public.shift_sessions (shift_id);

create table public.todo_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  items text[] not null check (cardinality(items) between 1 and 100),
  everyone boolean not null default true,
  people uuid[] not null default '{}',
  repeat_unit text check (repeat_unit in ('shift', 'hours', 'days', 'weeks', 'months')),
  repeat_every int check (repeat_every between 1 and 365),
  repeat_from timestamptz,
  slot_start timestamptz,
  slot_end timestamptz,
  mode text not null default 'add' check (mode in ('add', 'replace')),
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((repeat_unit is not null and repeat_every is not null and repeat_from is not null and slot_start is null)
      or (repeat_unit is null and slot_start is not null and slot_end > slot_start))
);

create table public.session_todos (
  session_id uuid not null references public.shift_sessions (id) on delete cascade,
  template_id uuid not null references public.todo_templates (id) on delete cascade,
  item int not null,
  done_at timestamptz not null default now(),
  primary key (session_id, template_id, item)
);

alter table public.shift_sessions enable row level security;
alter table public.todo_templates enable row level security;
alter table public.session_todos enable row level security;
revoke all on public.shift_sessions, public.todo_templates, public.session_todos from anon;
revoke insert, update, delete, truncate on public.shift_sessions, public.todo_templates, public.session_todos from authenticated;
create policy "sessions: admins and viewers see all, RCMs their own" on public.shift_sessions for select to authenticated
  using (public.sees_everything() or owner = auth.uid());
create policy "templates: admins see all, RCMs the ones for them" on public.todo_templates for select to authenticated
  using (public.is_admin() or everyone or auth.uid() = any (people));
create policy "session todos follow their session" on public.session_todos for select to authenticated
  using (exists (select 1 from public.shift_sessions s where s.id = session_id and (public.sees_everything() or s.owner = auth.uid())));

-- Ends sessions nobody confirmed for 30 minutes, at the time of the question.
create function public.close_stale_sessions() returns void
language sql security definer set search_path = '' as $$
  update public.shift_sessions set ended_at = check_due_at, ended_by = 'timeout'
  where ended_at is null and now() >= check_due_at + interval '30 minutes';
$$;

create function public.start_shift_session(p_shift uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  s public.shifts;
  v_id uuid;
begin
  perform public.close_stale_sessions();
  select * into s from public.shifts where id = p_shift;
  if not found then raise exception 'RCM_NOT_FOUND: that shift no longer exists'; end if;
  if s.owner <> me.id then raise exception 'RCM_FORBIDDEN: you can only start your own shifts'; end if;
  if s.status <> 'booked' then raise exception 'RCM_INVALID: this shift is not confirmed'; end if;
  if now() < s.starts_at or now() >= s.ends_at then raise exception 'RCM_INVALID: you can start a shift only while it is on'; end if;
  if exists (select 1 from public.shift_sessions where owner = me.id and ended_at is null) then
    raise exception 'RCM_INVALID: you already started a shift';
  end if;
  insert into public.shift_sessions (shift_id, owner, check_due_at) values (s.id, me.id, s.ends_at) returning id into v_id;
  return v_id;
end $$;

-- "Yes, I'm still working": the next question comes 30 minutes later.
create function public.confirm_shift_session(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_writer();
begin
  perform public.close_stale_sessions();
  update public.shift_sessions set check_due_at = now() + interval '30 minutes'
  where id = p_id and owner = me.id and ended_at is null and now() >= check_due_at;
  if not found then raise exception 'RCM_INVALID: this shift has already ended'; end if;
end $$;

create function public.end_shift_session(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_writer();
begin
  perform public.close_stale_sessions();
  update public.shift_sessions set ended_at = now(), ended_by = 'user' where id = p_id and owner = me.id and ended_at is null;
  if not found then raise exception 'RCM_INVALID: this shift has already ended'; end if;
end $$;

create function public.toggle_session_todo(p_session uuid, p_template uuid, p_item int, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_writer();
begin
  if not exists (select 1 from public.shift_sessions where id = p_session and owner = me.id) then
    raise exception 'RCM_FORBIDDEN: only the person working the shift can tick its to-dos';
  end if;
  if p_done then
    insert into public.session_todos (session_id, template_id, item) values (p_session, p_template, p_item) on conflict do nothing;
  else
    delete from public.session_todos where session_id = p_session and template_id = p_template and item = p_item;
  end if;
end $$;

-- p: {title, items[], everyone, people[], repeat: {unit, every, from} | null, slot: {start, end} | null, mode}
create function public.save_todo_template(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  v_items text[] := array(select btrim(x) from jsonb_array_elements_text(coalesce(p -> 'items', '[]')) x where btrim(x) <> '');
  v_people uuid[] := array(select (x)::uuid from jsonb_array_elements_text(coalesce(p -> 'people', '[]')) x);
  v_everyone boolean := coalesce((p ->> 'everyone')::boolean, false);
  v_unit text := p -> 'repeat' ->> 'unit';
  v_every int := (p -> 'repeat' ->> 'every')::int;
  v_from timestamptz := (p -> 'repeat' ->> 'from')::timestamptz;
  v_s timestamptz := (p -> 'slot' ->> 'start')::timestamptz;
  v_e timestamptz := (p -> 'slot' ->> 'end')::timestamptz;
  v_id uuid;
  clash text;
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins write to-do templates'; end if;
  if length(btrim(coalesce(p ->> 'title', ''))) = 0 then raise exception 'RCM_INVALID: give the template a title'; end if;
  if cardinality(v_items) = 0 then raise exception 'RCM_INVALID: write at least one line of the checklist'; end if;
  if not v_everyone and cardinality(v_people) = 0 then raise exception 'RCM_INVALID: choose who gets this checklist'; end if;
  if v_unit is null and (v_s is null or v_e is null or v_e <= v_s) then raise exception 'RCM_INVALID: pick the time slot'; end if;
  if v_unit is not null and (v_every is null or v_every < 1 or v_every > 365 or v_from is null) then raise exception 'RCM_INVALID: repeat every 1 to 365'; end if;
  if v_everyone then v_people := '{}'; end if;

  select t.title into clash from public.todo_templates t
  where t.id is distinct from p_id
    and (v_everyone or t.everyone or t.people && v_people)
    and (
      (v_unit = 'shift' and t.repeat_unit = 'shift')
      or (v_unit is null and t.repeat_unit is null and tstzrange(t.slot_start, t.slot_end) && tstzrange(v_s, v_e))
      or (v_unit <> 'shift' and t.repeat_unit = v_unit and t.repeat_every = v_every and t.repeat_from = v_from)
    )
  limit 1;
  if clash is not null then
    raise exception 'RCM_INVALID: “%” already covers the same shifts for some of these people', clash;
  end if;

  if p_id is null then
    insert into public.todo_templates (title, items, everyone, people, repeat_unit, repeat_every, repeat_from, slot_start, slot_end, mode, created_by)
    values (btrim(p ->> 'title'), v_items, v_everyone, v_people, v_unit, case when v_unit is null then null else v_every end, case when v_unit is null then null else v_from end,
      case when v_unit is null then v_s end, case when v_unit is null then v_e end, coalesce(p ->> 'mode', 'add'), me.id)
    returning id into v_id;
  else
    update public.todo_templates set title = btrim(p ->> 'title'), items = v_items, everyone = v_everyone, people = v_people,
      repeat_unit = v_unit, repeat_every = case when v_unit is null then null else v_every end, repeat_from = case when v_unit is null then null else v_from end,
      slot_start = case when v_unit is null then v_s end, slot_end = case when v_unit is null then v_e end,
      mode = coalesce(p ->> 'mode', 'add'), updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'RCM_NOT_FOUND: that template no longer exists'; end if;
  end if;
  return v_id;
end $$;

create function public.delete_todo_template(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_profile();
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins write to-do templates'; end if;
  delete from public.todo_templates where id = p_id;
end $$;

revoke execute on function public.close_stale_sessions() from public, anon;
revoke execute on function public.start_shift_session(uuid) from public, anon;
revoke execute on function public.confirm_shift_session(uuid) from public, anon;
revoke execute on function public.end_shift_session(uuid) from public, anon;
revoke execute on function public.toggle_session_todo(uuid, uuid, int, boolean) from public, anon;
revoke execute on function public.save_todo_template(uuid, jsonb) from public, anon;
revoke execute on function public.delete_todo_template(uuid) from public, anon;

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['shift_sessions', 'todo_templates', 'session_todos'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
