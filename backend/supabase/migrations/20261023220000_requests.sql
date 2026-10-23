-- Aram, 23 Oct 2026 (evening):
--  * An RCM booking (or moving a shift) outside the required coverage OR outside their
--    availability creates a request (status 'pending'); admins approve or reject it.
--    Pending shifts reserve the slot but cannot be reported on.
--  * No "ask for cover" once a shift has started.
--  * RCMs cannot change or delete a shift of a past day (in their own time zone).
--  * History: RCMs see only entries that involve them; admins and viewers see all;
--    only admins delete entries.
--  * Admins get notifications; notification_seen remembers when each admin last looked.

alter table public.shifts drop constraint shifts_status_check;
alter table public.shifts add constraint shifts_status_check check (status in ('booked', 'open', 'covered', 'pending'));

alter table public.shift_log drop constraint shift_log_action_check;
alter table public.shift_log add constraint shift_log_action_check check (action in (
  'booked', 'edited', 'deleted', 'restored', 'ask', 'cancelask', 'took', 'gaveback', 'reported',
  'requested', 'approved', 'rejected'));

-- Required coverage between two instants, as a multirange (empty target = nothing required).
create function public._required(p_from timestamptz, p_to timestamptz) returns tstzmultirange
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.coverage;
  v_day date;
  v_slot jsonb;
  acc tstzmultirange := '{}'::tstzmultirange;
begin
  select * into c from public.coverage where id = 1;
  if not found then return acc; end if;
  for v_day in
    select generate_series((p_from at time zone c.tz)::date - 1, (p_to at time zone c.tz)::date + 1, interval '1 day')::date
  loop
    for v_slot in select x from jsonb_array_elements(coalesce(c.days -> extract(isodow from v_day)::int::text, '[]'::jsonb)) x loop
      acc := acc + tstzmultirange(tstzrange(
        (v_day + make_interval(mins => (v_slot ->> 'start')::int)) at time zone c.tz,
        (v_day + make_interval(mins => (v_slot ->> 'end')::int)) at time zone c.tz));
    end loop;
  end loop;
  return acc;
end $$;

-- Inside the required coverage. With no target set, every hour counts as required.
create function public._is_required(p_start timestamptz, p_end timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.coverage where id = 1 and days <> '{}'::jsonb) then true
    else public._required(p_start, p_end) @> tstzrange(p_start, p_end)
  end
$$;

-- 'pending' when an RCM acts outside the required hours or their availability.
create function public._rcm_status(me public.profiles, p_owner uuid, p_start timestamptz, p_end timestamptz) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when me.role = 'rcm' and not (public._is_available(p_owner, p_start, p_end) and public._is_required(p_start, p_end)) then 'pending'
    else 'booked'
  end
$$;

-- A shift on a day before today, in its owner's time zone.
create function public._past_day(p_owner uuid, p_start timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_start < (date_trunc('day', now() at time zone coalesce(p.timezone, 'UTC')) at time zone coalesce(p.timezone, 'UTC'))
  from public.profiles p where p.id = p_owner
$$;

create or replace function public.book_shift(p_start timestamptz, p_end timestamptz, p_owner uuid default null, p_restore boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  v_owner uuid := coalesce(p_owner, me.id);
  v_status text;
  v_id uuid;
begin
  if v_owner <> me.id and me.role <> 'admin' then
    raise exception 'RCM_FORBIDDEN: only admins can book for someone else';
  end if;
  perform public._active_rcm(v_owner);
  perform public._check_range(p_start, p_end);
  perform public._assert_free(p_start, p_end, '{}');
  v_status := public._rcm_status(me, v_owner, p_start, p_end);
  insert into public.shifts (owner, starts_at, ends_at, status, created_by) values (v_owner, p_start, p_end, v_status, me.id) returning id into v_id;
  perform public._log(me.id, v_owner, case when v_status = 'pending' then 'requested' when p_restore then 'restored' else 'booked' end, v_id, p_start, p_end);
  return v_id;
end $$;

create or replace function public.update_shift(p_id uuid, p_start timestamptz, p_end timestamptz, p_owner uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  s public.shifts := public._manageable(p_id, me);
  v_owner uuid := coalesce(p_owner, s.owner);
  v_status text;
begin
  if s.status not in ('booked', 'pending') then raise exception 'RCM_INVALID: only booked shifts and requests can be changed'; end if;
  if me.role = 'rcm' and public._past_day(s.owner, s.starts_at) then
    raise exception 'RCM_FORBIDDEN: shifts of past days can only be changed by an admin';
  end if;
  if v_owner <> s.owner then
    if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can reassign shifts'; end if;
    perform public._active_rcm(v_owner);
  end if;
  perform public._check_range(p_start, p_end);
  perform public._assert_free(p_start, p_end, array[s.id]);
  v_status := case when me.role = 'admin' then s.status else public._rcm_status(me, v_owner, p_start, p_end) end;
  update public.shifts set starts_at = p_start, ends_at = p_end, owner = v_owner, status = v_status, updated_at = now() where id = s.id;
  perform public._log(me.id, v_owner, case when v_status = 'pending' and me.role = 'rcm' then 'requested' else 'edited' end, s.id, p_start, p_end);
end $$;

create or replace function public.delete_shift(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  s public.shifts := public._manageable(p_id, me);
begin
  if s.status = 'covered' then raise exception 'RCM_INVALID: this shift was taken over; delete the cover shift instead'; end if;
  if me.role = 'rcm' and public._past_day(s.owner, s.starts_at) then
    raise exception 'RCM_FORBIDDEN: shifts of past days can only be deleted by an admin';
  end if;
  delete from public.shifts where id = s.id;
  if s.covers_id is not null then
    update public.shifts set status = 'open', updated_at = now() where id = s.covers_id and status = 'covered';
    perform public._log(me.id, s.owner, 'gaveback', s.id, s.starts_at, s.ends_at);
  else
    perform public._log(me.id, s.owner, 'deleted', s.id, s.starts_at, s.ends_at);
  end if;
end $$;

create or replace function public.ask_cover(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  s public.shifts := public._manageable(p_id, me);
begin
  if s.status <> 'booked' or s.covers_id is not null then
    raise exception 'RCM_INVALID: only your own booked shifts can be put up for cover';
  end if;
  if s.starts_at <= now() then raise exception 'RCM_INVALID: this shift has already started'; end if;
  update public.shifts set status = 'open', updated_at = now() where id = s.id;
  perform public._log(me.id, s.owner, 'ask', s.id, s.starts_at, s.ends_at);
end $$;

create or replace function public.save_report(p_shift uuid, p_worked_minutes int, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  s public.shifts := public._manageable(p_shift, me);
begin
  if s.status = 'covered' then raise exception 'RCM_INVALID: this shift was taken over; the cover shift gets the report'; end if;
  if s.status = 'pending' then raise exception 'RCM_INVALID: this shift is waiting for an admin to approve it'; end if;
  if s.starts_at > now() then raise exception 'RCM_INVALID: you can report on a shift once it has started'; end if;
  if p_worked_minutes is null or p_worked_minutes < 0 or p_worked_minutes > 1440 then
    raise exception 'RCM_INVALID: worked hours must be between 0 and 24';
  end if;
  if length(coalesce(p_notes, '')) > 4000 then raise exception 'RCM_INVALID: the report is too long'; end if;
  insert into public.shift_reports (shift_id, owner, worked_minutes, notes, created_by, updated_by)
  values (s.id, s.owner, p_worked_minutes, btrim(coalesce(p_notes, '')), me.id, me.id)
  on conflict (shift_id) do update set
    owner = excluded.owner, worked_minutes = excluded.worked_minutes, notes = excluded.notes,
    updated_by = me.id, updated_at = now();
  perform public._log(me.id, s.owner, 'reported', s.id, s.starts_at, s.ends_at);
end $$;

create function public.approve_shift(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  s public.shifts;
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can approve requests'; end if;
  select * into s from public.shifts where id = p_id for update;
  if not found then raise exception 'RCM_NOT_FOUND: that request no longer exists'; end if;
  if s.status <> 'pending' then raise exception 'RCM_INVALID: this shift is not waiting for approval'; end if;
  update public.shifts set status = 'booked', updated_at = now() where id = s.id;
  perform public._log(me.id, s.owner, 'approved', s.id, s.starts_at, s.ends_at);
end $$;

create function public.reject_shift(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  s public.shifts;
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can reject requests'; end if;
  select * into s from public.shifts where id = p_id for update;
  if not found then raise exception 'RCM_NOT_FOUND: that request no longer exists'; end if;
  if s.status <> 'pending' then raise exception 'RCM_INVALID: this shift is not waiting for approval'; end if;
  delete from public.shifts where id = s.id;
  perform public._log(me.id, s.owner, 'rejected', s.id, s.starts_at, s.ends_at);
end $$;

-- History by role -------------------------------------------------------------

create function public.sees_everything() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'viewer'))
$$;

drop policy "signed-in users see the history" on public.shift_log;
create policy "admins and viewers see all history, RCMs their own" on public.shift_log for select to authenticated
  using (public.sees_everything() or actor = auth.uid() or owner = auth.uid() or from_owner = auth.uid());

create function public.delete_log(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_profile();
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can delete history entries'; end if;
  delete from public.shift_log where id = p_id;
end $$;

-- Notifications ---------------------------------------------------------------

create table public.notification_seen (
  admin uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.notification_seen enable row level security;
revoke all on public.notification_seen from anon;
revoke insert, update, delete, truncate on public.notification_seen from authenticated;
create policy "admins see when they last looked" on public.notification_seen for select to authenticated using (admin = auth.uid());

create function public.mark_notifications_seen() returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_profile();
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins have notifications'; end if;
  insert into public.notification_seen (admin, seen_at) values (me.id, now())
  on conflict (admin) do update set seen_at = excluded.seen_at;
end $$;

revoke execute on function public._required(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public._is_required(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public._rcm_status(public.profiles, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public._past_day(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.approve_shift(uuid) from public, anon;
revoke execute on function public.reject_shift(uuid) from public, anon;
revoke execute on function public.delete_log(bigint) from public, anon;
revoke execute on function public.mark_notifications_seen() from public, anon;
revoke execute on function public.sees_everything() from public, anon;
