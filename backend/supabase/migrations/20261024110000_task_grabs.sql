-- Tasks created without assignees are up for grabs either for RCMs or for admins:
-- the admin picks which when creating the task. RCMs only see (and take) the RCM ones.

alter table public.tasks add column grabs_for text not null default 'rcm' check (grabs_for in ('rcm', 'admin'));

create or replace function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and (
      p.role = 'admin' or (p.role = 'rcm' and (
        exists (select 1 from public.task_assignees a where a.task_id = p_task and a.person = p.id)
        or (
          not exists (select 1 from public.task_assignees a where a.task_id = p_task)
          and exists (select 1 from public.tasks t where t.id = p_task and t.grabs_for = 'rcm')
        )
      ))
    )
  )
$$;

create function public._check_grabs(p_people uuid[], p_grabs_for text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_grabs_for is not null and p_grabs_for not in ('rcm', 'admin') then raise exception 'RCM_INVALID: unknown audience'; end if;
  if coalesce(cardinality(p_people), 0) = 0 and p_grabs_for is null then
    raise exception 'RCM_INVALID: choose whether this task is up for grabs for RCMs or for admins';
  end if;
  return coalesce(p_grabs_for, 'rcm');
end $$;

drop function public.create_task(text, text, text, int, uuid[]);
create function public.create_task(p_title text, p_description text, p_priority text, p_estimate int, p_people uuid[], p_grabs_for text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  v_id uuid;
  v_grabs text;
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can create tasks'; end if;
  perform public._check_task(p_title, p_description, p_priority, p_estimate, p_people);
  v_grabs := public._check_grabs(p_people, p_grabs_for);
  insert into public.tasks (title, description, priority, estimate_minutes, grabs_for, created_by)
  values (btrim(p_title), btrim(coalesce(p_description, '')), p_priority, p_estimate, v_grabs, me.id) returning id into v_id;
  insert into public.task_assignees (task_id, person) select distinct v_id, x from unnest(coalesce(p_people, '{}')) x;
  perform public._task_log(me.id, v_id, btrim(p_title), null, 'created', null);
  return v_id;
end $$;

drop function public.update_task(uuid, text, text, text, int, uuid[]);
create function public.update_task(p_id uuid, p_title text, p_description text, p_priority text, p_estimate int, p_people uuid[], p_grabs_for text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  v_grabs text;
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can change tasks'; end if;
  perform 1 from public.tasks where id = p_id for update;
  if not found then raise exception 'RCM_NOT_FOUND: that task no longer exists'; end if;
  perform public._check_task(p_title, p_description, p_priority, p_estimate, p_people);
  v_grabs := public._check_grabs(p_people, coalesce(p_grabs_for, case when coalesce(cardinality(p_people), 0) = 0 then (select grabs_for from public.tasks where id = p_id) end));
  update public.tasks set title = btrim(p_title), description = btrim(coalesce(p_description, '')), priority = p_priority,
    estimate_minutes = p_estimate, grabs_for = v_grabs, updated_at = now() where id = p_id;
  delete from public.task_assignees where task_id = p_id and person <> all (coalesce(p_people, '{}'));
  insert into public.task_assignees (task_id, person) select distinct p_id, x from unnest(coalesce(p_people, '{}')) x
  on conflict (task_id, person) do nothing;
  perform public._task_log(me.id, p_id, btrim(p_title), null, 'edited', null);
end $$;

-- RCMs take RCM tasks, admins take admin tasks.
create or replace function public.claim_task(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  t public.tasks;
begin
  select * into t from public.tasks where id = p_id for update;
  if not found or (me.role = 'rcm' and t.grabs_for <> 'rcm') then raise exception 'RCM_NOT_FOUND: that task no longer exists'; end if;
  if (me.role = 'rcm') <> (t.grabs_for = 'rcm') then raise exception 'RCM_FORBIDDEN: this task is up for grabs for RCMs'; end if;
  if exists (select 1 from public.task_assignees where task_id = p_id) then
    raise exception 'RCM_INVALID: someone already took this task';
  end if;
  insert into public.task_assignees (task_id, person) values (p_id, me.id);
  perform public._task_log(me.id, p_id, t.title, me.id, 'claimed', 'todo');
end $$;

revoke execute on function public._check_grabs(uuid[], text) from public, anon, authenticated;
revoke execute on function public.create_task(text, text, text, int, uuid[], text) from public, anon;
revoke execute on function public.update_task(uuid, text, text, text, int, uuid[], text) from public, anon;
