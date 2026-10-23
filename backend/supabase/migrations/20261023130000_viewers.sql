-- Read-only viewers (Max, Adrien): they see the whole board, history and reports,
-- choose their own time zone, and cannot change anything else.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'rcm', 'viewer'));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, full_name, role)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    case when new.raw_app_meta_data ->> 'role' in ('admin', 'viewer') then new.raw_app_meta_data ->> 'role' else 'rcm' end
  );
  return new;
end $$;

-- The caller's profile, if they may change things (admins and RCMs).
create function public.current_writer() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles := public.current_profile();
begin
  if p.role = 'viewer' then raise exception 'RCM_FORBIDDEN: you have read-only access'; end if;
  return p;
end $$;
revoke execute on function public.current_writer() from public, anon;

-- Shifts can only belong to admins and RCMs.
create or replace function public._active_rcm(p_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = p_id and active and role <> 'viewer') then
    raise exception 'RCM_INVALID: that person has no active RCM login';
  end if;
end $$;

create or replace function public._manageable(p_id uuid, me public.profiles) returns public.shifts
language plpgsql security definer set search_path = '' as $$
declare s public.shifts;
begin
  if me.role = 'viewer' then raise exception 'RCM_FORBIDDEN: you have read-only access'; end if;
  select * into s from public.shifts where id = p_id for update;
  if not found then raise exception 'RCM_NOT_FOUND: that shift no longer exists'; end if;
  if s.owner <> me.id and me.role <> 'admin' then
    raise exception 'RCM_FORBIDDEN: only the person who booked this shift or an admin can change it';
  end if;
  return s;
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
  perform public._assert_free(p_start, p_end, '{}');
  insert into public.shifts (owner, starts_at, ends_at, created_by) values (v_owner, p_start, p_end, me.id) returning id into v_id;
  perform public._log(me.id, v_owner, case when p_restore then 'restored' else 'booked' end, v_id, p_start, p_end);
  return v_id;
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
  update public.shifts set status = 'covered', updated_at = now() where id = s.id;
  perform public._assert_free(s.starts_at, s.ends_at, array[s.id]);
  insert into public.shifts (owner, starts_at, ends_at, covers_id, created_by)
    values (v_taker, s.starts_at, s.ends_at, s.id, me.id) returning id into v_id;
  perform public._log(me.id, v_taker, 'took', v_id, s.starts_at, s.ends_at, s.owner);
  return v_id;
end $$;

create or replace function public.admin_update_profile(p_id uuid, p_full_name text, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_profile();
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can change profiles'; end if;
  if p_role is null or p_role not in ('admin', 'rcm', 'viewer') then raise exception 'RCM_INVALID: role must be admin, rcm or viewer'; end if;
  if p_id = me.id and (p_role <> 'admin' or not p_active) then
    raise exception 'RCM_INVALID: you cannot remove your own admin access';
  end if;
  update public.profiles set full_name = btrim(p_full_name), role = p_role, active = p_active where id = p_id;
  if not found then raise exception 'RCM_NOT_FOUND: no such person'; end if;
end $$;
