-- Live updates: the board refreshes when anyone changes shifts, coverage or the team.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shifts, public.shift_log, public.coverage, public.profiles;
  end if;
end $$;
