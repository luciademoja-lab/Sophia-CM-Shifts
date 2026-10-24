-- Booking rules, October 2026:
-- * RCMs may book and take shifts outside their availability without approval; only bookings
--   outside the required hours still become requests.
-- * RCMs book only in the current and the next week (Monday–Sunday, in their time zone).
--   On Sundays the week after next opens as well.

-- [from, to) where an RCM may have shifts booked, in their own time zone.
create function public._rcm_window(p_owner uuid) returns tstzrange
language sql stable security definer set search_path = '' as $$
  with z as (select coalesce((select timezone from public.profiles where id = p_owner), 'UTC') as tz),
       w as (select tz, date_trunc('week', now() at time zone tz) as mon, extract(isodow from now() at time zone tz) as dow from z)
  select tstzrange(mon at time zone tz, (mon + interval '14 days' + case when dow = 7 then interval '7 days' else interval '0' end) at time zone tz, '[)') from w
$$;

create or replace function public._rcm_status(me public.profiles, p_owner uuid, p_start timestamptz, p_end timestamptz) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if me.role <> 'rcm' then return 'booked'; end if;
  if not (tstzrange(p_start, p_end, '[)') <@ public._rcm_window(p_owner)) then
    raise exception 'RCM_INVALID: you can book shifts in this week and next week only (the week after opens on Sunday)';
  end if;
  return case when public._is_required(p_start, p_end) then 'booked' else 'pending' end;
end $$;

-- Taking a shift that needs cover no longer depends on availability.
create or replace function public._assert_rcm_available(me public.profiles, p_owner uuid, p_start timestamptz, p_end timestamptz) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  return;
end $$;

revoke execute on function public._rcm_window(uuid) from public, anon, authenticated;
