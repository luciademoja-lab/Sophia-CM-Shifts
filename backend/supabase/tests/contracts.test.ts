import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDb, failure } from './db';

// Every morning an admin pastes the new Upwork contracts; they are split evenly into one task
// per chosen RCM, one checklist line per contract.
describe('contract tasks', () => {
  let db: TestDb;
  let aram: string, regina: string, kris: string, rana: string, olizhia: string, max: string;

  beforeAll(() => {
    db = TestDb.create();
    aram = db.createUser('aadmin', 'Aram Hamawandy', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    kris = db.createUser('kris', 'Kris Arévalo');
    rana = db.createUser('rana', 'Rana Barakli');
    olizhia = db.createUser('olizhia', 'Olizhia Mairuhu');
    max = db.createUser('max', 'Max', 'viewer');
  });
  afterAll(() => db.drop());
  beforeEach(() => db.exec('super', 'delete from task_log; delete from tasks;'));

  const items = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ label: `Poster ${i + 1}`, url: `https://www.upwork.com/ab/c/${i + 1}` })));
  const share = (as: string, people: string[], n: number, json = items(n)) =>
    db.value<string[]>({ id: as }, `select create_contract_tasks('New posters', 'Steps', 'high', 5, array[${people.map((p) => `'${p}'`).join(',')}]::uuid[], '${json}'::jsonb)`);

  it('splits the contracts evenly and in order, one task per RCM', () => {
    const ids = share(aram, [regina, kris, rana, olizhia], 10);
    expect(ids).toHaveLength(4);
    const rows = db.rows<{ person: string; n: number; first: string; estimate: number }>('super', `
      select a.person, count(i.*)::int as n, min(i.label) filter (where i.position = (select min(position) from task_items where task_id = t.id)) as first, t.estimate_minutes as estimate
      from tasks t join task_assignees a on a.task_id = t.id join task_items i on i.task_id = t.id group by a.person, t.id order by min(i.position)`);
    expect(rows.map((r) => [r.person, r.n, r.first, r.estimate])).toEqual([
      [regina, 3, 'Poster 1', 15], [kris, 3, 'Poster 4', 15], [rana, 2, 'Poster 7', 10], [olizhia, 2, 'Poster 9', 10],
    ]);
  });

  it('skips people with nothing to do when there are fewer contracts than RCMs', () => {
    expect(share(aram, [regina, kris, rana], 2)).toHaveLength(2);
  });

  it('is for admins, active RCMs and real links only', () => {
    expect(failure(() => share(regina, [kris], 2))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => share(aram, [max], 2))).toMatch(/RCM_INVALID/);
    expect(failure(() => share(aram, [aram], 2))).toMatch(/RCM_INVALID/);
    expect(failure(() => share(aram, [], 2))).toMatch(/RCM_INVALID/);
    expect(failure(() => share(aram, [regina], 0))).toMatch(/RCM_INVALID/);
    expect(failure(() => share(aram, [regina], 1, JSON.stringify([{ label: 'x', url: 'javascript:alert(1)' }])))).toMatch(/RCM_INVALID/);
  });

  it('shows each RCM only their own contracts and lets them tick lines off', () => {
    share(aram, [regina, kris], 4);
    expect(db.value({ id: regina }, 'select count(*) from task_items')).toBe(2);
    expect(db.value({ id: max }, 'select count(*) from task_items')).toBe(0);
    const [mine] = db.rows<{ id: string }>({ id: regina }, 'select id from task_items order by position');
    const [theirs] = db.rows<{ id: string }>({ id: kris }, 'select id from task_items order by position');
    db.exec({ id: regina }, `select toggle_task_item('${mine.id}', true)`);
    expect(db.rows('super', `select done_at is not null as done, done_by from task_items where id = '${mine.id}'`)).toEqual([{ done: true, done_by: regina }]);
    expect(failure(() => db.exec({ id: regina }, `select toggle_task_item('${theirs.id}', true)`))).toMatch(/RCM_FORBIDDEN/);
    db.exec({ id: regina }, `select toggle_task_item('${mine.id}', false)`);
    expect(db.value('super', `select done_at from task_items where id = '${mine.id}'`)).toBeNull();
    db.exec({ id: aram }, `select toggle_task_item('${theirs.id}', true)`);
  });
});
