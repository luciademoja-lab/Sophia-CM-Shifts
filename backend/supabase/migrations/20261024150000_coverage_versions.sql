-- Every change to the required coverage is kept, so the dashboard can compare the hours we
-- required each week (with the target in force at the time) with the hours worked.

create table public.coverage_versions (
  id bigserial primary key,
  valid_from timestamptz not null default now(),
  tz text not null,
  days jsonb not null,
  changed_by uuid references public.profiles (id) on delete set null
);
create index coverage_versions_from_idx on public.coverage_versions (valid_from);
alter table public.coverage_versions enable row level security;
revoke all on public.coverage_versions from anon;
revoke insert, update, delete, truncate on public.coverage_versions from authenticated;
create policy "admins and viewers see the coverage history" on public.coverage_versions for select to authenticated using (public.sees_everything());

create function public._keep_coverage_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.coverage_versions (valid_from, tz, days, changed_by) values (now(), new.tz, new.days, new.updated_by);
  return new;
end $$;
create trigger coverage_keep_version after insert or update on public.coverage
  for each row execute function public._keep_coverage_version();
revoke execute on function public._keep_coverage_version() from public, anon, authenticated;

-- the target set before this history existed counts from the beginning
insert into public.coverage_versions (valid_from, tz, days, changed_by)
select '2000-01-01T00:00:00Z', tz, days, updated_by from public.coverage;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'coverage_versions') then
    alter publication supabase_realtime add table public.coverage_versions;
  end if;
end $$;
