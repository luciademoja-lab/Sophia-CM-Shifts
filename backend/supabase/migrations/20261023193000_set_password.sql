-- Change a login's password straight from the Supabase SQL editor, by username:
--   select set_password('ladmin', 'new-password-2026');
-- It also confirms the login. Only the database owner (the SQL editor) can run it;
-- the app's roles (anon, authenticated) cannot.

create function public.set_password(p_username text, p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_id uuid;
begin
  if p_password is null or length(p_password) < 10 then
    raise exception 'RCM_INVALID: password must be at least 10 characters';
  end if;
  if p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' then
    raise exception 'RCM_INVALID: password needs at least one letter and one number';
  end if;
  select id into v_id from public.profiles where username = v_username;
  if v_id is null then raise exception 'RCM_NOT_FOUND: no login with username %', v_username; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = v_id;
  return 'Password updated for ' || v_username || '.';
end $$;

revoke execute on function public.set_password(text, text) from public, anon, authenticated;
