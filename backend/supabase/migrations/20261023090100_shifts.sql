-- Shifts (booked availability) and their history. Clients only read these tables;
-- every change goes through the functions below, which check permissions, enforce
-- "one RCM per slot" and write the history entry in the same transaction.

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- booked = available, open = needs cover, covered = taken over by another shift
  status text not null default 'booked' check (status in ('booked', 'open', 'covered')),
  covers_id uuid references public.shifts (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_valid_range check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  constraint shifts_one_rcm_per_slot exclude using gist (tstzrange(starts_at, ends_at) with &&) where (status <> 'covered')
);
create index shifts_range_idx on public.shifts (starts_at, ends_at);

create table public.shift_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default clock_timestamp(),
  actor uuid not null references public.profiles (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  action text not null check (action in ('booked', 'edited', 'deleted', 'restored', 'ask', 'cancelask', 'took', 'gaveback')),
  shift_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  from_owner uuid references public.profiles (id) on delete set null
);
create index shift_log_at_idx on public.shift_log (at desc);

alter table public.shifts enable row level security;
alter table public.shift_log enable row level security;
revoke all on public.shifts, public.shift_log from anon;
revoke insert, update, delete, truncate on public.shifts, public.shift_log from authenticated;
create policy "signed-in users see the board" on public.shifts for select to authenticated using (true);
create policy "signed-in users see the history" on public.shift_log for select to authenticated using (true);

-- helpers -------------------------------------------------------------------

create function public._check_range(p_start timestamptz, p_end timestamptz) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'RCM_INVALID: the end must be after the start';
  end if;
  if p_end - p_start > interval '24 hours' then
    raise exception 'RCM_INVALID: a shift can last at most 24 hours';
  end if;
end $$;

create function public._overlap_message(p_start timestamptz, p_end timestamptz, p_ignore uuid[]) returns text
language sql stable security definer set search_path = '' as $$
  select 'RCM_OVERLAP: overlaps ' || p.full_name || '''s shift ' || to_char(s.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')
    || '/' || to_char(s.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')
  from public.shifts s join public.profiles p on p.id = s.owner
  where s.status <> 'covered' and s.starts_at < p_end and p_start < s.ends_at and not (s.id = any (p_ignore))
  order by s.starts_at limit 1
$$;

create function public._assert_free(p_start timestamptz, p_end timestamptz, p_ignore uuid[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare msg text := public._overlap_message(p_start, p_end, p_ignore);
begin
  if msg is not null then raise exception '%', msg; end if;
end $$;

create function public._active_rcm(p_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = p_id and active) then
    raise exception 'RCM_INVALID: that person has no active login';
  end if;
end $$;

-- A shift the caller may change: their own, or any shift for an admin.
create function public._manageable(p_id uuid, me public.profiles) returns public.shifts
language plpgsql security definer set search_path = '' as $$
declare s public.shifts;
begin
  select * into s from public.shifts where id = p_id for update;
  if not found then raise exception 'RCM_NOT_FOUND: that shift no longer exists'; end if;
  if s.owner <> me.id and me.role <> 'admin' then
    raise exception 'RCM_FORBIDDEN: only the person who booked this shift or an admin can change it';
  end if;
  return s;
end $$;

create function public._log(p_actor uuid, p_owner uuid, p_action text, p_shift uuid, p_start timestamptz, p_end timestamptz, p_from uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.shift_log (actor, owner, action, shift_id, starts_at, ends_at, from_owner)
  values (p_actor, p_owner, p_action, p_shift, p_start, p_end, p_from)
$$;

-- API -----------------------------------------------------------------------

create function public.book_shift(p_start timestamptz, p_end timestamptz, p_owner uuid default null, p_restore boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  v_owner uuid := coalesce(p_owner, me.id);
  v_id uuid;
begin
  if v_owner <> me.id and me.role <> 'admin' then
    raise exception 'RCM_FORBIDDEN: only admins can book for someone else';
  end if;
  perform public._active_rcm(v_owner);
  perform public._check_range(p_start, p_end);
  perform public._assert_free(p_start, p_end, '{}');
  insert into public.shifts (owner, starts_at, ends_at, created_by) values (v_owner, p_start, p_end, me.id) returning id into v_id;
  perform public._log(me.id, v_owner, case when p_restore then 'restored' else 'booked' end, v_id, p_start, p_end);
  return v_id;
end $$;

create function public.update_shift(p_id uuid, p_start timestamptz, p_end timestamptz, p_owner uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  s public.shifts := public._manageable(p_id, me);
  v_owner uuid := coalesce(p_owner, s.owner);
begin
  if s.status <> 'booked' then raise exception 'RCM_INVALID: only booked shifts can be changed'; end if;
  if v_owner <> s.owner then
    if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can reassign shifts'; end if;
    perform public._active_rcm(v_owner);
  end if;
  perform public._check_range(p_start, p_end);
  perform public._assert_free(p_start, p_end, array[s.id]);
  update public.shifts set starts_at = p_start, ends_at = p_end, owner = v_owner, updated_at = now() where id = s.id;
  perform public._log(me.id, v_owner, 'edited', s.id, p_start, p_end);
end $$;

create function public.delete_shift(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  s public.shifts := public._manageable(p_id, me);
begin
  if s.status = 'covered' then raise exception 'RCM_INVALID: this shift was taken over; delete the cover shift instead'; end if;
  delete from public.shifts where id = s.id;
  if s.covers_id is not null then
    update public.shifts set status = 'open', updated_at = now() where id = s.covers_id and status = 'covered';
    perform public._log(me.id, s.owner, 'gaveback', s.id, s.starts_at, s.ends_at);
  else
    perform public._log(me.id, s.owner, 'deleted', s.id, s.starts_at, s.ends_at);
  end if;
end $$;

create function public.ask_cover(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  s public.shifts := public._manageable(p_id, me);
begin
  if s.status <> 'booked' or s.covers_id is not null then
    raise exception 'RCM_INVALID: only your own booked shifts can be put up for cover';
  end if;
  update public.shifts set status = 'open', updated_at = now() where id = s.id;
  perform public._log(me.id, s.owner, 'ask', s.id, s.starts_at, s.ends_at);
end $$;

create function public.cancel_ask(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  s public.shifts := public._manageable(p_id, me);
begin
  if s.status <> 'open' then raise exception 'RCM_INVALID: this shift is not waiting for cover'; end if;
  update public.shifts set status = 'booked', updated_at = now() where id = s.id;
  perform public._log(me.id, s.owner, 'cancelask', s.id, s.starts_at, s.ends_at);
end $$;

create function public.take_shift(p_id uuid, p_for uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  v_taker uuid := coalesce(p_for, me.id);
  s public.shifts;
  v_id uuid;
begin
  if v_taker <> me.id and me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can give a shift to someone'; end if;
  perform public._active_rcm(v_taker);
  select * into s from public.shifts where id = p_id for update;
  if not found then raise exception 'RCM_NOT_FOUND: that shift no longer exists'; end if;
  if s.status <> 'open' then raise exception 'RCM_INVALID: this shift does not need cover any more'; end if;
  if s.owner = v_taker then raise exception 'RCM_INVALID: withdraw the cover request instead of taking your own shift'; end if;
  update public.shifts set status = 'covered', updated_at = now() where id = s.id;
  perform public._assert_free(s.starts_at, s.ends_at, array[s.id]);
  insert into public.shifts (owner, starts_at, ends_at, covers_id, created_by)
    values (v_taker, s.starts_at, s.ends_at, s.id, me.id) returning id into v_id;
  perform public._log(me.id, v_taker, 'took', v_id, s.starts_at, s.ends_at, s.owner);
  return v_id;
end $$;

-- Only the API functions are callable by signed-in users.
revoke execute on function public._check_range(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public._overlap_message(timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
revoke execute on function public._assert_free(timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
revoke execute on function public._active_rcm(uuid) from public, anon, authenticated;
revoke execute on function public._manageable(uuid, public.profiles) from public, anon, authenticated;
revoke execute on function public._log(uuid, uuid, text, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.book_shift(timestamptz, timestamptz, uuid, boolean) from public, anon;
revoke execute on function public.update_shift(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.delete_shift(uuid) from public, anon;
revoke execute on function public.ask_cover(uuid) from public, anon;
revoke execute on function public.cancel_ask(uuid) from public, anon;
revoke execute on function public.take_shift(uuid, uuid) from public, anon;
