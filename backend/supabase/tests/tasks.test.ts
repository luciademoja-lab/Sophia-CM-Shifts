import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDb, failure } from './db';

// Admins create tasks with a priority and an estimated time, and assign them to one or more
// people. Each assignee moves their own card; tasks without assignees are up for grabs.
describe('tasks', () => {
  let db: TestDb;
  let lucia: string, aram: string, regina: string, kris: string, max: string;

  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('ladmin', 'Lucia De Mojà', 'admin');
    aram = db.createUser('aadmin', 'Aram Hamawandy', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    kris = db.createUser('kris', 'Kris Arévalo');
    max = db.createUser('max', 'Max', 'viewer');
  });
  afterAll(() => db.drop());
  beforeEach(() => db.exec('super', 'delete from task_log; delete from tasks;'));

  const arr = (ids: string[]) => `array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]`;
  const create = (as: string, title: string, people: string[] = [], priority = 'normal', estimate = 60, grabsFor: string | null = 'rcm') =>
    db.value<string>({ id: as }, `select create_task('${title}', '', '${priority}', ${estimate}, ${arr(people)}, ${grabsFor ? `'${grabsFor}'` : 'null'})`);
  const move = (as: string, id: string, status: string, person: string | null = null) =>
    db.exec({ id: as }, `select move_task('${id}', ${person ? `'${person}'` : 'null'}, '${status}')`);
  const visible = (as: string) => db.rows<{ title: string }>({ id: as }, 'select title from tasks order by title').map((r) => r.title);
  const assignment = (id: string, person: string) => db.rows('super', `select status, done_at is not null as done from task_assignees where task_id = '${id}' and person = '${person}'`)[0];

  it('lets only admins create tasks, with a valid priority and estimate', () => {
    expect(create(lucia, 'Clean Zone B', [regina], 'high', 90)).toMatch(/[0-9a-f-]{36}/);
    expect(db.rows('super', `select priority, estimate_minutes from tasks`)).toEqual([{ priority: 'high', estimate_minutes: 90 }]);
    expect(failure(() => create(regina, 'Mine'))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => create(max, 'Mine'))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => create(lucia, 'Bad', [], 'whenever'))).toMatch(/RCM_INVALID/);
    expect(failure(() => create(lucia, 'Bad', [], 'normal', 0))).toMatch(/RCM_INVALID/);
    expect(failure(() => create(lucia, ' '))).toMatch(/RCM_INVALID/);
    expect(failure(() => create(lucia, 'Viewer', [max]))).toMatch(/RCM_INVALID/);
  });

  it('shows RCMs their own tasks and the ones up for grabs, admins everything, viewers nothing', () => {
    create(lucia, 'a regina', [regina]);
    create(lucia, 'b kris', [kris]);
    create(lucia, 'c admin', [aram]);
    create(lucia, 'd shared', [aram, regina]);
    create(lucia, 'e grabs');
    create(lucia, 'f admin grabs', [], 'normal', 60, 'admin');
    expect(visible(regina)).toEqual(['a regina', 'd shared', 'e grabs']);
    expect(visible(lucia)).toEqual(['a regina', 'b kris', 'c admin', 'd shared', 'e grabs', 'f admin grabs']);
    expect(visible(max)).toEqual([]);
    expect(db.rows({ id: regina }, 'select distinct person from task_assignees')).toEqual([{ person: regina }]); // never other people's cards
  });

  it('keeps a separate status for each assignee; RCMs move only their own', () => {
    const id = create(lucia, 'Shared', [regina, kris]);
    move(regina, id, 'in_progress');
    move(regina, id, 'done');
    expect(assignment(id, regina)).toEqual({ status: 'done', done: true });
    expect(assignment(id, kris)).toEqual({ status: 'todo', done: false });
    expect(failure(() => move(regina, id, 'done', kris))).toMatch(/RCM_FORBIDDEN/);
    move(lucia, id, 'in_progress', kris);
    expect(assignment(id, kris)).toEqual({ status: 'in_progress', done: false });
    move(regina, id, 'todo');
    expect(assignment(id, regina)).toEqual({ status: 'todo', done: false });
    expect(failure(() => move(max, id, 'done', regina))).toMatch(/RCM_FORBIDDEN/);
  });

  it('needs to know who can grab a task without assignees', () => {
    expect(failure(() => create(lucia, 'Nobody', [], 'normal', 60, null))).toMatch(/RCM_INVALID: .*up for grabs/);
    expect(() => create(lucia, 'Assigned', [regina], 'normal', 60, null)).not.toThrow();
  });

  it('lets admins grab the admin tasks, and RCMs only the RCM ones', () => {
    const forAdmins = create(lucia, 'For admins', [], 'normal', 60, 'admin');
    expect(failure(() => db.exec({ id: regina }, `select claim_task('${forAdmins}')`))).toMatch(/RCM_NOT_FOUND|RCM_FORBIDDEN/);
    db.exec({ id: aram }, `select claim_task('${forAdmins}')`);
    expect(assignment(forAdmins, aram)).toEqual({ status: 'todo', done: false });
    const forRcms = create(lucia, 'For RCMs');
    expect(failure(() => db.exec({ id: aram }, `select claim_task('${forRcms}')`))).toMatch(/RCM_FORBIDDEN/);
  });

  it('lets an RCM claim a task up for grabs with one click, only once', () => {
    const id = create(lucia, 'Free');
    db.exec({ id: regina }, `select claim_task('${id}')`);
    expect(assignment(id, regina)).toEqual({ status: 'todo', done: false });
    expect(failure(() => db.exec({ id: kris }, `select claim_task('${id}')`))).toMatch(/RCM_INVALID|RCM_NOT_FOUND/);
    expect(db.rows('super', `select action, actor from task_log order by id`).pop()).toEqual({ action: 'claimed', actor: regina });
  });

  it('lets admins edit and reassign, keeping the status of people who stay', () => {
    const id = create(lucia, 'Edit me', [regina, kris]);
    move(regina, id, 'in_progress');
    db.exec({ id: lucia }, `select update_task('${id}', 'Edited', 'more', 'urgent', 120, ${arr([regina, aram])}, null)`);
    expect(db.rows('super', `select title, priority, estimate_minutes from tasks`)).toEqual([{ title: 'Edited', priority: 'urgent', estimate_minutes: 120 }]);
    expect(assignment(id, regina)).toEqual({ status: 'in_progress', done: false });
    expect(assignment(id, aram)).toEqual({ status: 'todo', done: false });
    expect(assignment(id, kris)).toBeUndefined();
    expect(failure(() => db.exec({ id: regina }, `select update_task('${id}', 'x', '', 'low', 60, ${arr([regina])}, null)`))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => db.exec({ id: regina }, `select delete_task('${id}')`))).toMatch(/RCM_FORBIDDEN/);
    db.exec({ id: lucia }, `select delete_task('${id}')`);
    expect(visible(lucia)).toEqual([]);
  });

  it('logs task changes for the admins only', () => {
    const id = create(lucia, 'Logged', [regina]);
    move(regina, id, 'done');
    expect(db.rows({ id: lucia }, `select action, actor, status from task_log order by id`)).toEqual([
      { action: 'created', actor: lucia, status: null },
      { action: 'moved', actor: regina, status: 'done' },
    ]);
    expect(db.value({ id: regina }, 'select count(*) from task_log')).toBe(0);
    expect(failure(() => db.exec({ id: regina }, `insert into tasks (title, estimate_minutes) values ('x', 1)`))).toMatch(/permission denied/);
  });
});
