-- Tasks: admins create them with a priority and an estimated time (per assignee) and
-- assign them to one or more people. Each assignee has their own status
-- (todo / in_progress / done). Tasks without assignees are up for grabs for RCMs.
-- Visibility: admins see everything; RCMs see their own tasks and the ones up for grabs;
-- viewers see none.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 4000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  estimate_minutes int not null check (estimate_minutes between 1 and 6000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  person uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  done_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (task_id, person)
);
create index task_assignees_person_idx on public.task_assignees (person);

-- What happened to tasks, for the admins' notifications.
create table public.task_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid references public.profiles (id) on delete set null,
  task_id uuid,
  title text not null default '',
  person uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('created', 'edited', 'deleted', 'claimed', 'moved')),
  status text
);

create function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and (
      p.role = 'admin' or (p.role = 'rcm' and (
        not exists (select 1 from public.task_assignees a where a.task_id = p_task)
        or exists (select 1 from public.task_assignees a where a.task_id = p_task and a.person = p.id)
      ))
    )
  )
$$;

alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_log enable row level security;
revoke all on public.tasks, public.task_assignees, public.task_log from anon;
revoke insert, update, delete, truncate on public.tasks, public.task_assignees, public.task_log from authenticated;
create policy "admins see all tasks, RCMs theirs and the ones up for grabs" on public.tasks for select to authenticated
  using (public.can_see_task(id));
create policy "admins see all assignments, RCMs their own" on public.task_assignees for select to authenticated
  using (public.is_admin() or person = auth.uid());
create policy "admins see the task log" on public.task_log for select to authenticated using (public.is_admin());

create function public._task_log(p_actor uuid, p_task uuid, p_title text, p_person uuid, p_action text, p_status text)
returns void language sql security definer set search_path = '' as $$
  insert into public.task_log (actor, task_id, title, person, action, status) values (p_actor, p_task, p_title, p_person, p_action, p_status);
$$;

create function public._check_task(p_title text, p_description text, p_priority text, p_estimate int, p_people uuid[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'RCM_INVALID: give the task a title'; end if;
  if length(p_title) > 200 then raise exception 'RCM_INVALID: the title is too long'; end if;
  if length(coalesce(p_description, '')) > 4000 then raise exception 'RCM_INVALID: the description is too long'; end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'RCM_INVALID: pick a priority'; end if;
  if p_estimate is null or p_estimate < 1 or p_estimate > 6000 then raise exception 'RCM_INVALID: give the estimated time (up to 100 hours)'; end if;
  if exists (
    select 1 from unnest(coalesce(p_people, '{}')) x
    where not exists (select 1 from public.profiles p where p.id = x and p.active and p.role in ('admin', 'rcm'))
  ) then raise exception 'RCM_INVALID: tasks can only be assigned to admins and RCMs'; end if;
end $$;

create function public.create_task(p_title text, p_description text, p_priority text, p_estimate int, p_people uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  v_id uuid;
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can create tasks'; end if;
  perform public._check_task(p_title, p_description, p_priority, p_estimate, p_people);
  insert into public.tasks (title, description, priority, estimate_minutes, created_by)
  values (btrim(p_title), btrim(coalesce(p_description, '')), p_priority, p_estimate, me.id) returning id into v_id;
  insert into public.task_assignees (task_id, person) select distinct v_id, x from unnest(coalesce(p_people, '{}')) x;
  perform public._task_log(me.id, v_id, btrim(p_title), null, 'created', null);
  return v_id;
end $$;

create function public.update_task(p_id uuid, p_title text, p_description text, p_priority text, p_estimate int, p_people uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare me public.profiles := public.current_profile();
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can change tasks'; end if;
  perform 1 from public.tasks where id = p_id for update;
  if not found then raise exception 'RCM_NOT_FOUND: that task no longer exists'; end if;
  perform public._check_task(p_title, p_description, p_priority, p_estimate, p_people);
  update public.tasks set title = btrim(p_title), description = btrim(coalesce(p_description, '')), priority = p_priority,
    estimate_minutes = p_estimate, updated_at = now() where id = p_id;
  delete from public.task_assignees where task_id = p_id and person <> all (coalesce(p_people, '{}'));
  insert into public.task_assignees (task_id, person) select distinct p_id, x from unnest(coalesce(p_people, '{}')) x
  on conflict (task_id, person) do nothing;
  perform public._task_log(me.id, p_id, btrim(p_title), null, 'edited', null);
end $$;

create function public.delete_task(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  v_title text;
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can delete tasks'; end if;
  delete from public.tasks where id = p_id returning title into v_title;
  if v_title is not null then perform public._task_log(me.id, p_id, v_title, null, 'deleted', null); end if;
end $$;

-- Moves one assignee's card. RCMs move their own; admins anyone's.
create function public.move_task(p_id uuid, p_person uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  v_person uuid := coalesce(p_person, me.id);
  v_title text;
begin
  if v_person <> me.id and me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: you can only move your own tasks'; end if;
  if p_status is null or p_status not in ('todo', 'in_progress', 'done') then raise exception 'RCM_INVALID: unknown status'; end if;
  update public.task_assignees set status = p_status, updated_at = now(),
    done_at = case when p_status = 'done' then coalesce(case when status = 'done' then done_at end, now()) else null end
  where task_id = p_id and person = v_person;
  if not found then raise exception 'RCM_NOT_FOUND: that task is not assigned to this person'; end if;
  select title into v_title from public.tasks where id = p_id;
  perform public._task_log(me.id, p_id, v_title, v_person, 'moved', p_status);
end $$;

-- An RCM takes a task that nobody is assigned to.
create function public.claim_task(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  v_title text;
begin
  if me.role <> 'rcm' then raise exception 'RCM_FORBIDDEN: admins assign tasks from the task editor'; end if;
  select title into v_title from public.tasks where id = p_id for update;
  if not found then raise exception 'RCM_NOT_FOUND: that task no longer exists'; end if;
  if exists (select 1 from public.task_assignees where task_id = p_id) then
    raise exception 'RCM_INVALID: someone already took this task';
  end if;
  insert into public.task_assignees (task_id, person) values (p_id, me.id);
  perform public._task_log(me.id, p_id, v_title, me.id, 'claimed', 'todo');
end $$;

revoke execute on function public._task_log(uuid, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public._check_task(text, text, text, int, uuid[]) from public, anon, authenticated;
revoke execute on function public.can_see_task(uuid) from public, anon;
revoke execute on function public.create_task(text, text, text, int, uuid[]) from public, anon;
revoke execute on function public.update_task(uuid, text, text, text, int, uuid[]) from public, anon;
revoke execute on function public.delete_task(uuid) from public, anon;
revoke execute on function public.move_task(uuid, uuid, text) from public, anon;
revoke execute on function public.claim_task(uuid) from public, anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tasks, public.task_assignees, public.task_log;
  end if;
end $$;
