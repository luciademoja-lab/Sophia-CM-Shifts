-- Required coverage: the hours that must always have one RCM on duty, per weekday,
-- in one time zone. Each weekday holds a list of slots, so a day can have gaps:
--   days = { "1": [ {"start": 420, "end": 720}, {"start": 840, "end": 1440} ], ... }
-- (weekday 1 = Monday ... 7 = Sunday; minutes from midnight, end exclusive)

create table public.coverage (
  id smallint primary key default 1 check (id = 1),
  tz text not null,
  days jsonb not null default '{}',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.coverage enable row level security;
revoke all on public.coverage from anon;
revoke insert, update, delete, truncate on public.coverage from authenticated;
create policy "signed-in users see the target" on public.coverage for select to authenticated using (true);

create function public._normalize_coverage_days(p_days jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  k text; v jsonb; slot jsonb; s int; e int; prev_end int;
  out jsonb := '{}'; list jsonb;
begin
  if p_days is null or jsonb_typeof(p_days) <> 'object' then raise exception 'RCM_INVALID: days must be an object'; end if;
  for k, v in select * from jsonb_each(p_days) loop
    if k !~ '^[1-7]$' then raise exception 'RCM_INVALID: unknown weekday %', k; end if;
    if jsonb_typeof(v) <> 'array' then raise exception 'RCM_INVALID: weekday % must be a list of slots', k; end if;
    list := '[]'; prev_end := -1;
    for slot in select x from jsonb_array_elements(v) x order by (x ->> 'start')::int loop
      s := (slot ->> 'start')::int; e := (slot ->> 'end')::int;
      if s is null or e is null then raise exception 'RCM_INVALID: weekday % has a slot without start or end', k; end if;
      if s < 0 or e > 1440 then raise exception 'RCM_INVALID: times must be between 00:00 and 24:00'; end if;
      if s % 15 <> 0 or e % 15 <> 0 then raise exception 'RCM_INVALID: times must be on the quarter hour'; end if;
      if e <= s then raise exception 'RCM_INVALID: the end must be after the start'; end if;
      if s < prev_end then raise exception 'RCM_INVALID: slots on weekday % overlap', k; end if;
      list := list || jsonb_build_array(jsonb_build_object('start', s, 'end', e));
      prev_end := e;
    end loop;
    if jsonb_array_length(list) > 0 then out := out || jsonb_build_object(k, list); end if;
  end loop;
  return out;
end $$;

create function public.set_coverage(p_tz text, p_days jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  v_days jsonb;
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can change the coverage target'; end if;
  if p_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'RCM_INVALID: unknown time zone %', p_tz;
  end if;
  v_days := public._normalize_coverage_days(p_days);
  insert into public.coverage (id, tz, days, updated_by, updated_at) values (1, p_tz, v_days, me.id, now())
  on conflict (id) do update set tz = excluded.tz, days = excluded.days, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

revoke execute on function public._normalize_coverage_days(jsonb) from public, anon, authenticated;
revoke execute on function public.set_coverage(text, jsonb) from public, anon;
