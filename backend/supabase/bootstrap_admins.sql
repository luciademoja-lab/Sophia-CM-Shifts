-- One-off setup of the two admin logins, run in the Supabase SQL editor.
--
-- Before running it, create the two users once in Authentication > Users > Add user:
--   ladmin@rcm.vikstudios.com   (Lucia)   any password, tick "Auto Confirm User"
--   aadmin@rcm.vikstudios.com   (Aram)    any password, tick "Auto Confirm User"
-- The @rcm.vikstudios.com part is internal: in the app you sign in with just
-- "ladmin" or "aadmin". No email is ever sent to these addresses.

update public.profiles set role = 'admin', full_name = 'Lucia De Mojà' where username = 'ladmin';
update public.profiles set role = 'admin', full_name = 'Aram Hamawandy' where username = 'aadmin';

-- Set the passwords here (at least 10 characters, with a letter and a number):
select set_password('ladmin', 'CHANGE-ME-lucia-2026');
select set_password('aadmin', 'CHANGE-ME-aram-2026');

select username, full_name, role from public.profiles order by username;

-- Later, to change any password (admins or RCMs), just run for example:
--   select set_password('ladmin', 'a-new-password-2026');
