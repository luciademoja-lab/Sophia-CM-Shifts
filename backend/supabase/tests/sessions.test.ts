import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDb, failure, alwaysAvailable } from './db';

// Start/End shift, the 30-minute "still working?" rule, and to-do templates.
describe('shift sessions and to-do templates', () => {
  let db: TestDb;
  let lucia: string, regina: string, kris: string, max: string;
  let now: string, later: string;

  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('ladmin', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    kris = db.createUser('kris', 'Kris Arévalo');
    max = db.createUser('max', 'Max', 'viewer');
    alwaysAvailable(db, regina, kris);
  });
  afterAll(() => db.drop());
  beforeEach(() => {
    db.exec('super', 'delete from todo_templates; delete from shift_sessions; delete from shift_log; delete from shifts;');
    now = db.value<string>({ id: lucia }, `select book_shift(now() - interval '1 hour', now() + interval '2 hours', '${regina}')`);
    later = db.value<string>({ id: lucia }, `select book_shift(now() + interval '5 hours', now() + interval '7 hours', '${regina}')`);
  });
  const start = (as: string, shift: string) => db.value<string>({ id: as }, `select start_shift_session('${shift}')`);
  const row = (id: string) => db.rows('super', `select ended_by, ended_at is not null as ended, round(extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60) as minutes from shift_sessions where id = '${id}'`)[0];

  it('starts only the RCM\'s own shift, only while it is on, one at a time', () => {
    expect(failure(() => start(kris, now))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => start(regina, later))).toMatch(/RCM_INVALID: .*while it is on/);
    const id = start(regina, now);
    expect(row(id)).toMatchObject({ ended: false });
    expect(failure(() => start(regina, now))).toMatch(/RCM_INVALID: .*already started/);
    db.exec({ id: regina }, `select end_shift_session('${id}')`);
    expect(row(id)).toMatchObject({ ended: true, ended_by: 'user' });
  });

  it('asks "still working?" after the shift ends; Yes pushes the question 30 minutes later', () => {
    const id = start(regina, now);
    expect(failure(() => db.exec({ id: regina }, `select confirm_shift_session('${id}')`))).toMatch(/RCM_INVALID/); // not asked yet
    db.exec('super', `update shift_sessions set check_due_at = now() - interval '10 minutes' where id = '${id}'`);
    db.exec({ id: regina }, `select confirm_shift_session('${id}')`);
    expect(db.value('super', `select round(extract(epoch from check_due_at - now()) / 60) from shift_sessions where id = '${id}'`)).toBe(30);
  });

  it('ends at the question time when nobody answers for 30 minutes, without counting those minutes', () => {
    const id = start(regina, now);
    db.exec('super', `update shift_sessions set started_at = now() - interval '3 hours', check_due_at = now() - interval '31 minutes' where id = '${id}'`);
    db.exec({ id: regina }, 'select close_stale_sessions()');
    expect(row(id)).toMatchObject({ ended: true, ended_by: 'timeout', minutes: 149 });
    expect(failure(() => db.exec({ id: regina }, `select end_shift_session('${id}')`))).toMatch(/RCM_INVALID/);
  });

  it('shows sessions to their RCM, admins and viewers', () => {
    start(regina, now);
    expect(db.value({ id: kris }, 'select count(*) from shift_sessions')).toBe(0);
    expect(db.value({ id: max }, 'select count(*) from shift_sessions')).toBe(1);
  });

  const save = (as: string, p: unknown, id: string | null = null) =>
    db.value<string>({ id: as }, `select save_todo_template(${id ? `'${id}'` : 'null'}, '${JSON.stringify(p).replace(/'/g, "''")}'::jsonb)`);
  const every = { title: 'Every shift', items: ['Check Zone A', 'Answer DMs'], everyone: true, people: [], repeat: { unit: 'shift', every: 1, from: '2026-10-26T00:00:00Z' }, slot: null, mode: 'add' };

  it('lets only admins write templates, and RCMs see the ones for them', () => {
    expect(failure(() => save(regina, every))).toMatch(/RCM_FORBIDDEN/);
    save(lucia, every);
    save(lucia, { ...every, title: 'Kris only', everyone: false, people: [kris], repeat: null, slot: { start: '2026-10-26T09:00:00Z', end: '2026-10-26T12:00:00Z' } });
    expect(db.rows<{ title: string }>({ id: regina }, 'select title from todo_templates order by title').map((r) => r.title)).toEqual(['Every shift']);
    expect(db.value({ id: kris }, 'select count(*) from todo_templates')).toBe(2);
  });

  it('refuses two templates covering the same shifts of the same person', () => {
    const id = save(lucia, every);
    expect(failure(() => save(lucia, { ...every, title: 'Again' }))).toMatch(/RCM_INVALID: .*Every shift/);
    expect(() => save(lucia, { ...every, title: 'Edited' }, id)).not.toThrow();
    const slot = (title: string, a: string, b: string) => ({ ...every, title, repeat: null, slot: { start: a, end: b } });
    save(lucia, slot('Monday', '2026-10-26T09:00:00Z', '2026-10-26T12:00:00Z'));
    expect(failure(() => save(lucia, slot('Overlap', '2026-10-26T11:00:00Z', '2026-10-26T13:00:00Z')))).toMatch(/RCM_INVALID/);
    expect(() => save(lucia, slot('After', '2026-10-26T12:00:00Z', '2026-10-26T13:00:00Z'))).not.toThrow();
    expect(failure(() => save(lucia, { ...every, title: 'Empty', items: [' '] }))).toMatch(/RCM_INVALID/);
  });

  it('lets the RCM tick the to-dos of their own session', () => {
    const t = save(lucia, every);
    const s = start(regina, now);
    db.exec({ id: regina }, `select toggle_session_todo('${s}', '${t}', 1, true)`);
    expect(db.value({ id: regina }, 'select count(*) from session_todos')).toBe(1);
    expect(failure(() => db.exec({ id: kris }, `select toggle_session_todo('${s}', '${t}', 0, true)`))).toMatch(/RCM_FORBIDDEN/);
    db.exec({ id: regina }, `select toggle_session_todo('${s}', '${t}', 1, false)`);
    expect(db.value({ id: regina }, 'select count(*) from session_todos')).toBe(0);
  });
});
