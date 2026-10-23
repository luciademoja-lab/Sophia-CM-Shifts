-- Run once in the Supabase SQL editor (local Studio or the hosted project) after
-- creating Lucia's and Aram's users under Authentication > Users > Add user, with
-- emails lucia@rcm.vikstudios.com and aram@rcm.vikstudios.com (tick "Auto confirm").
-- From then on, every other login is created from the app (Team > Create login).
update public.profiles set role = 'admin', full_name = 'Lucia De Mojà' where username = 'lucia';
update public.profiles set role = 'admin', full_name = 'Aram Hamawandy' where username = 'aram';
select username, full_name, role from public.profiles order by username;
