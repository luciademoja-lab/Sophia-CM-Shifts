-- Availability: each RCM declares a usual week (slots per weekday, in their own time
-- zone) plus exceptions for specific dates that replace that day's usual slots.
-- RCMs can book, move or take shifts only inside their availability; admins can
-- assign anywhere (the app warns them when it is outside).

create table public.availability (
  owner uuid primary key references public.profiles (id) on delete cascade,
  days jsonb not null default '{}',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.availability_days (
  owner uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  slots jsonb not null default '[]',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (owner, day)
);

alter table public.availability enable row level security;
alter table public.availability_days enable row level security;
revoke all on public.availability, public.availability_days from anon;
revoke insert, update, delete, truncate on public.availability, public.availability_days from authenticated;
create policy "signed-in users see availability" on public.availability for select to authenticated using (true);
create policy "signed-in users see availability exceptions" on public.availability_days for select to authenticated using (true);

-- The person whose availability is being changed: yourself, or anyone for an admin.
create function public._availability_owner(me public.profiles, p_owner uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid := coalesce(p_owner, me.id);
begin
  if v_owner <> me.id and me.role <> 'admin' then
    raise exception 'RCM_FORBIDDEN: only admins can change someone else''s availability';
  end if;
  perform public._active_rcm(v_owner);
  return v_owner;
end $$;

create function public.set_availability(p_days jsonb, p_owner uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  v_owner uuid := public._availability_owner(me, p_owner);
begin
  insert into public.availability (owner, days, updated_by, updated_at)
  values (v_owner, public._normalize_coverage_days(p_days), me.id, now())
  on conflict (owner) do update set days = excluded.days, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

-- p_slots = null removes the exception (back to the usual week); [] = not available that day.
create function public.set_availability_day(p_day date, p_slots jsonb, p_owner uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  v_owner uuid := public._availability_owner(me, p_owner);
  v_slots jsonb;
begin
  if p_day is null then raise exception 'RCM_INVALID: pick a day'; end if;
  if p_slots is null then
    delete from public.availability_days where owner = v_owner and day = p_day;
    return;
  end if;
  if jsonb_typeof(p_slots) <> 'array' then raise exception 'RCM_INVALID: slots must be a list'; end if;
  v_slots := coalesce(public._normalize_coverage_days(jsonb_build_object('1', p_slots)) -> '1', '[]'::jsonb);
  insert into public.availability_days (owner, day, slots, updated_by, updated_at)
  values (v_owner, p_day, v_slots, me.id, now())
  on conflict (owner, day) do update set slots = excluded.slots, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

-- Available time of an RCM between two instants, as a multirange.
create function public._availability(p_owner uuid, p_from timestamptz, p_to timestamptz) returns tstzmultirange
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  v_week jsonb;
  v_day date;
  v_slots jsonb;
  v_slot jsonb;
  acc tstzmultirange := '{}'::tstzmultirange;
begin
  select timezone into v_tz from public.profiles where id = p_owner;
  if v_tz is null then return acc; end if;
  select days into v_week from public.availability where owner = p_owner;
  for v_day in
    select generate_series((p_from at time zone v_tz)::date - 1, (p_to at time zone v_tz)::date + 1, interval '1 day')::date
  loop
    select ad.slots into v_slots from public.availability_days ad where ad.owner = p_owner and ad.day = v_day;
    if not found then v_slots := coalesce(v_week -> extract(isodow from v_day)::int::text, '[]'::jsonb); end if;
    for v_slot in select x from jsonb_array_elements(v_slots) x loop
      acc := acc + tstzmultirange(tstzrange(
        (v_day + make_interval(mins => (v_slot ->> 'start')::int)) at time zone v_tz,
        (v_day + make_interval(mins => (v_slot ->> 'end')::int)) at time zone v_tz));
    end loop;
  end loop;
  return acc;
end $$;

create function public._is_available(p_owner uuid, p_start timestamptz, p_end timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select public._availability(p_owner, p_start, p_end) @> tstzrange(p_start, p_end)
$$;

-- RCMs act only inside their own availability; admins are not limited.
create function public._assert_rcm_available(me public.profiles, p_owner uuid, p_start timestamptz, p_end timestamptz) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if me.role = 'rcm' and not public._is_available(p_owner, p_start, p_end) then
    raise exception 'RCM_UNAVAILABLE: this is outside your availability. Add these hours to your availability first.';
  end if;
end $$;

create or replace function public.book_shift(p_start timestamptz, p_end timestamptz, p_owner uuid default null, p_restore boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  v_owner uuid := coalesce(p_owner, me.id);
  v_id uuid;
begin
  if v_owner <> me.id and me.role <> 'admin' then
    raise exception 'RCM_FORBIDDEN: only admins can book for someone else';
  end if;
  perform public._active_rcm(v_owner);
  perform public._check_range(p_start, p_end);
  perform public._assert_rcm_available(me, v_owner, p_start, p_end);
  perform public._assert_free(p_start, p_end, '{}');
  insert into public.shifts (owner, starts_at, ends_at, created_by) values (v_owner, p_start, p_end, me.id) returning id into v_id;
  perform public._log(me.id, v_owner, case when p_restore then 'restored' else 'booked' end, v_id, p_start, p_end);
  return v_id;
end $$;

create or replace function public.update_shift(p_id uuid, p_start timestamptz, p_end timestamptz, p_owner uuid default null)
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
  perform public._assert_rcm_available(me, v_owner, p_start, p_end);
  perform public._assert_free(p_start, p_end, array[s.id]);
  update public.shifts set starts_at = p_start, ends_at = p_end, owner = v_owner, updated_at = now() where id = s.id;
  perform public._log(me.id, v_owner, 'edited', s.id, p_start, p_end);
end $$;

create or replace function public.take_shift(p_id uuid, p_for uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
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
  perform public._assert_rcm_available(me, v_taker, s.starts_at, s.ends_at);
  update public.shifts set status = 'covered', updated_at = now() where id = s.id;
  perform public._assert_free(s.starts_at, s.ends_at, array[s.id]);
  insert into public.shifts (owner, starts_at, ends_at, covers_id, created_by)
    values (v_taker, s.starts_at, s.ends_at, s.id, me.id) returning id into v_id;
  perform public._log(me.id, v_taker, 'took', v_id, s.starts_at, s.ends_at, s.owner);
  return v_id;
end $$;

revoke execute on function public._availability_owner(public.profiles, uuid) from public, anon, authenticated;
revoke execute on function public._availability(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public._is_available(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public._assert_rcm_available(public.profiles, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.set_availability(jsonb, uuid) from public, anon;
revoke execute on function public.set_availability_day(date, jsonb, uuid) from public, anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.availability, public.availability_days;
  end if;
end $$;
