-- Realtime: make sure every table the board listens to is in the publication.
-- notification_seen was missing, which stopped live updates for the whole board.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['shifts', 'shift_log', 'coverage', 'profiles', 'shift_reports', 'availability', 'availability_days',
    'notification_seen', 'tasks', 'task_assignees', 'task_log', 'report_tasks', 'weekly_reports'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
