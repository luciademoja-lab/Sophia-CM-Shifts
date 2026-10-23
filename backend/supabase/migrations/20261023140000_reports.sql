-- Shift reports: after (or during) a shift the RCM records what they did and how
-- many hours they actually worked, which can differ from the booked slot.
-- Editable by the shift owner and admins; readable by everyone signed in.

create table public.shift_reports (
  shift_id uuid primary key references public.shifts (id) on delete cascade,
  owner uuid not null references public.profiles (id) on delete cascade,
  worked_minutes int not null check (worked_minutes between 0 and 1440),
  notes text not null default '' check (length(notes) <= 4000),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shift_reports_owner_idx on public.shift_reports (owner);

alter table public.shift_reports enable row level security;
revoke all on public.shift_reports from anon;
revoke insert, update, delete, truncate on public.shift_reports from authenticated;
create policy "signed-in users see the reports" on public.shift_reports for select to authenticated using (true);

alter table public.shift_log drop constraint shift_log_action_check;
alter table public.shift_log add constraint shift_log_action_check
  check (action in ('booked', 'edited', 'deleted', 'restored', 'ask', 'cancelask', 'took', 'gaveback', 'reported'));

create function public.save_report(p_shift uuid, p_worked_minutes int, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  s public.shifts := public._manageable(p_shift, me);
begin
  if s.status = 'covered' then raise exception 'RCM_INVALID: this shift was taken over; the cover shift gets the report'; end if;
  if s.starts_at > now() then raise exception 'RCM_INVALID: you can report on a shift once it has started'; end if;
  if p_worked_minutes is null or p_worked_minutes < 0 or p_worked_minutes > 1440 then
    raise exception 'RCM_INVALID: worked hours must be between 0 and 24';
  end if;
  if length(coalesce(p_notes, '')) > 4000 then raise exception 'RCM_INVALID: the report is too long'; end if;
  insert into public.shift_reports (shift_id, owner, worked_minutes, notes, created_by, updated_by)
  values (s.id, s.owner, p_worked_minutes, btrim(coalesce(p_notes, '')), me.id, me.id)
  on conflict (shift_id) do update set
    owner = excluded.owner, worked_minutes = excluded.worked_minutes, notes = excluded.notes,
    updated_by = me.id, updated_at = now();
  perform public._log(me.id, s.owner, 'reported', s.id, s.starts_at, s.ends_at);
end $$;

create function public.delete_report(p_shift uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  s public.shifts := public._manageable(p_shift, me);
begin
  delete from public.shift_reports where shift_id = s.id;
end $$;

revoke execute on function public.save_report(uuid, int, text) from public, anon;
revoke execute on function public.delete_report(uuid) from public, anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shift_reports;
  end if;
end $$;
