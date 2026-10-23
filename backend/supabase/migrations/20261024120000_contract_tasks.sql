-- Morning contract list: an admin pastes the new Upwork contracts and the app splits them
-- evenly into one task per chosen RCM. Each contract is a checklist line (name + link)
-- the RCM ticks once the poster has an OS profile and a Slack invite.

create table public.task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  position int not null,
  label text not null check (length(label) between 1 and 200),
  url text not null check (url ~* '^https?://' and length(url) <= 1000),
  done_at timestamptz,
  done_by uuid references public.profiles (id) on delete set null
);
create index task_items_task_idx on public.task_items (task_id, position);
alter table public.task_items enable row level security;
revoke all on public.task_items from anon;
revoke insert, update, delete, truncate on public.task_items from authenticated;
create policy "task items follow their task" on public.task_items for select to authenticated using (public.can_see_task(task_id));

-- p_items: [{label, url}] in order. p_people: the RCMs who share them (in order).
create function public.create_contract_tasks(p_title text, p_description text, p_priority text, p_minutes_each int, p_people uuid[], p_items jsonb)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_profile();
  n int := coalesce(cardinality(p_people), 0);
  total int;
  k int;
  v_from int := 0;
  v_size int;
  v_id uuid;
  ids uuid[] := '{}';
begin
  if me.role <> 'admin' then raise exception 'RCM_FORBIDDEN: only admins can share out contracts'; end if;
  if n = 0 then raise exception 'RCM_INVALID: pick at least one RCM'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'RCM_INVALID: paste at least one contract link';
  end if;
  total := jsonb_array_length(p_items);
  if total > 500 then raise exception 'RCM_INVALID: at most 500 contracts at a time'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) i where coalesce(i ->> 'url', '') !~* '^https?://') then
    raise exception 'RCM_INVALID: every contract needs a link starting with https://';
  end if;
  if p_minutes_each is null or p_minutes_each < 1 or p_minutes_each > 240 then raise exception 'RCM_INVALID: minutes per contract must be between 1 and 240'; end if;
  if exists (select 1 from unnest(p_people) x where not exists (select 1 from public.profiles p where p.id = x and p.active and p.role = 'rcm')) then
    raise exception 'RCM_INVALID: contracts can only go to active RCMs';
  end if;
  if (select count(distinct x) from unnest(p_people) x) <> n then raise exception 'RCM_INVALID: the same RCM is listed twice'; end if;

  for k in 1 .. n loop
    v_size := total / n + case when k <= total % n then 1 else 0 end;
    if v_size > 0 then
      perform public._check_task(p_title, p_description, p_priority, v_size * p_minutes_each, array[p_people[k]]);
      insert into public.tasks (title, description, priority, estimate_minutes, grabs_for, created_by)
      values (btrim(p_title), btrim(coalesce(p_description, '')), p_priority, v_size * p_minutes_each, 'rcm', me.id) returning id into v_id;
      insert into public.task_assignees (task_id, person) values (v_id, p_people[k]);
      insert into public.task_items (task_id, position, label, url)
      select v_id, i.ord, left(coalesce(nullif(btrim(i.v ->> 'label'), ''), i.v ->> 'url'), 200), i.v ->> 'url'
      from jsonb_array_elements(p_items) with ordinality as i(v, ord)
      where i.ord > v_from and i.ord <= v_from + v_size;
      perform public._task_log(me.id, v_id, btrim(p_title), p_people[k], 'created', null);
      ids := ids || v_id;
    end if;
    v_from := v_from + v_size;
  end loop;
  return ids;
end $$;

-- The assignee (or an admin) ticks a contract off.
create function public.toggle_task_item(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := public.current_writer();
  it public.task_items;
begin
  select * into it from public.task_items where id = p_item for update;
  if not found then raise exception 'RCM_NOT_FOUND: that line no longer exists'; end if;
  if me.role <> 'admin' and not exists (select 1 from public.task_assignees where task_id = it.task_id and person = me.id) then
    raise exception 'RCM_FORBIDDEN: only the people assigned to this task can tick it';
  end if;
  update public.task_items set done_at = case when p_done then coalesce(done_at, now()) end, done_by = case when p_done then me.id end where id = p_item;
end $$;

revoke execute on function public.create_contract_tasks(text, text, text, int, uuid[], jsonb) from public, anon;
revoke execute on function public.toggle_task_item(uuid, boolean) from public, anon;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'task_items') then
    alter publication supabase_realtime add table public.task_items;
  end if;
end $$;
