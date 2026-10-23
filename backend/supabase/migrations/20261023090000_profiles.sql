-- Profiles: one per login. Logins are created by admins (Lucia, Aram) through the
-- admin-users Edge Function; RCMs choose their own time zone at first sign-in.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  full_name text not null check (length(btrim(full_name)) between 1 and 80),
  role text not null default 'rcm' check (role in ('admin', 'rcm')),
  timezone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
create policy "signed-in users see the team" on public.profiles for select to authenticated using (true);

-- New auth user -> profile. The role comes from app metadata, which only the
-- service role (the admin-users function) can set.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username, full_name, role)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin' else 'rcm' end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- The caller's profile, or an error if not signed in / deactivated.
create function public.current_profile() returns public.profiles
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  if auth.uid() is null then raise exception 'RCM_NOT_SIGNED_IN'; end if;
  select * into p from public.profiles where id = auth.uid();
  if not found or not p.active then raise exception 'RCM_FORBIDDEN: this login is not active'; end if;
  return p;
end $$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active)
$$;

create function public.set_my_timezone(p_tz text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_profile();
begin
  if p_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'RCM_INVALID: unknown time zone %', p_tz;
  end if;
  update public.profiles set timezone = p_tz where id = me.id;
end $$;

create function public.admin_update_profile(p_id uuid, p_full_name text, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_profile();
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can change profiles'; end if;
  if p_id = me.id and (p_role <> 'admin' or not p_active) then
    raise exception 'RCM_INVALID: you cannot remove your own admin access';
  end if;
  update public.profiles set full_name = btrim(p_full_name), role = p_role, active = p_active where id = p_id;
  if not found then raise exception 'RCM_NOT_FOUND: no such person'; end if;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.current_profile() from public, anon;
revoke execute on function public.set_my_timezone(text) from public, anon;
revoke execute on function public.admin_update_profile(uuid, text, text, boolean) from public, anon;
