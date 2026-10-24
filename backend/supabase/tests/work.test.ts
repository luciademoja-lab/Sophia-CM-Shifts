import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDb, failure, alwaysAvailable } from './db';

// Shift reports carry the kinds of work from the Vik 2.0 guide and the time spent on tasks.
// Every week, from Sunday on, the RCM sends a weekly report built from the hours they reported.
const lastWeek = (day: number, h: number) => `(date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' - interval '7 days' + interval '${day} days' + interval '${h} hours')`;
const nextWeek = (day: number, h: number) => `(date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' + interval '7 days' + interval '${day} days' + interval '${h} hours')`;
const LAST_MONDAY = `(date_trunc('week', now() at time zone 'UTC') - interval '7 days')::date`;
const NEXT_MONDAY = `(date_trunc('week', now() at time zone 'UTC') + interval '7 days')::date`;

describe('reports and weekly reports', () => {
  let db: TestDb;
  let lucia: string, regina: string, kris: string, max: string;
  let shift: string, shift2: string, task: string;

  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('ladmin', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    kris = db.createUser('kris', 'Kris Arévalo');
    max = db.createUser('max', 'Max', 'viewer');
    alwaysAvailable(db, regina, kris); // UTC
  });
  afterAll(() => db.drop());
  beforeEach(() => {
    db.exec('super', 'delete from weekly_reports; delete from shift_reports; delete from shift_log; delete from shifts; delete from task_log; delete from tasks;');
    // last week is outside the RCM booking window, so an admin books these shifts for Regina
    shift = db.value<string>({ id: lucia }, `select book_shift(${lastWeek(0, 8)}, ${lastWeek(0, 14)}, '${regina}')`);
    shift2 = db.value<string>({ id: lucia }, `select book_shift(${lastWeek(2, 8)}, ${lastWeek(2, 12)}, '${regina}')`);
    task = db.value<string>({ id: lucia }, `select create_task('Clean Zone B', '', 'normal', 120, array['${regina}']::uuid[])`);
  });

  const save = (as: string, minutes: number, types: string[], posters = '', tasks: Array<[string, number]> = [], id = shift) =>
    db.exec({ id: as }, `select save_report('${id}', ${minutes}, 'notes', array[${types.map((t) => `'${t}'`).join(',')}]::text[], '${posters}', '${JSON.stringify(tasks.map(([t, m]) => ({ task_id: t, minutes: m })))}'::jsonb)`);

  it('saves the kinds of work and the posters with issues', () => {
    save(regina, 330, ['onboarding', 'poster_issues'], 'Ana, Bo');
    expect(db.rows('super', `select worked_minutes, work_types, posters from shift_reports`)).toEqual([{ worked_minutes: 330, work_types: ['onboarding', 'poster_issues'], posters: 'Ana, Bo' }]);
  });

  it('accepts only the four kinds of work, and needs posters for poster issues', () => {
    expect(failure(() => save(regina, 60, ['payments']))).toMatch(/RCM_INVALID/);
    expect(failure(() => save(regina, 60, []))).toMatch(/RCM_INVALID: tick at least one/);
    expect(failure(() => save(regina, 60, ['poster_issues']))).toMatch(/RCM_INVALID: write the names/);
  });

  it('links time to the RCM\'s own tasks, within the hours worked', () => {
    save(regina, 300, [], '', [[task, 90]]);
    expect(db.rows('super', `select task_id, owner, minutes from report_tasks`)).toEqual([{ task_id: task, owner: regina, minutes: 90 }]);
    save(regina, 300, ['community'], '', []);
    expect(db.value('super', 'select count(*) from report_tasks')).toBe(0);
    expect(failure(() => save(regina, 60, [], '', [[task, 90]]))).toMatch(/RCM_INVALID/);
    const other = db.value<string>({ id: lucia }, `select create_task('Kris only', '', 'normal', 60, array['${kris}']::uuid[])`);
    expect(failure(() => save(regina, 300, [], '', [[other, 30]]))).toMatch(/RCM_INVALID: .*assigned/);
  });

  it('lets RCMs read their own task time, admins everyone\'s', () => {
    save(regina, 300, [], '', [[task, 90]]);
    expect(db.value({ id: regina }, 'select count(*) from report_tasks')).toBe(1);
    expect(db.value({ id: kris }, 'select count(*) from report_tasks')).toBe(0);
    expect(db.value({ id: lucia }, 'select count(*) from report_tasks')).toBe(1);
  });

  const submit = (as: string, week: string, message = 'My week') =>
    db.value<string>({ id: as }, `select submit_weekly(${week}, '${message}')`);

  it('builds the weekly hours from the reported time, not the booked time', () => {
    save(regina, 330, ['onboarding']);
    save(regina, 200, ['community'], '', [], shift2);
    const id = submit(regina, LAST_MONDAY);
    expect(db.rows('super', `select owner, worked_minutes, status, message from weekly_reports where id = '${id}'`)).toEqual([{ owner: regina, worked_minutes: 530, status: 'submitted', message: 'My week' }]);
  });

  it('opens the weekly report only from the Sunday of that week', () => {
    expect(failure(() => submit(regina, NEXT_MONDAY))).toMatch(/RCM_INVALID: .*Sunday/);
    expect(failure(() => submit(regina, `(${LAST_MONDAY} + 1)`))).toMatch(/RCM_INVALID/); // not a Monday
  });

  it('is sent by RCMs only and approved or rejected by admins', () => {
    save(regina, 330, ['onboarding']);
    expect(failure(() => submit(lucia, LAST_MONDAY))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => submit(max, LAST_MONDAY))).toMatch(/RCM_FORBIDDEN/);
    const id = submit(regina, LAST_MONDAY);
    expect(failure(() => db.exec({ id: kris }, `select approve_weekly('${id}')`))).toMatch(/RCM_FORBIDDEN/);
    db.exec({ id: lucia }, `select reject_weekly('${id}')`);
    expect(db.value('super', `select status from weekly_reports where id = '${id}'`)).toBe('rejected');
    expect(submit(regina, LAST_MONDAY, 'Fixed')).toBe(id); // sent again after a rejection
    db.exec({ id: lucia }, `select approve_weekly('${id}')`);
    expect(db.rows('super', `select status, decided_by from weekly_reports`)).toEqual([{ status: 'approved', decided_by: lucia }]);
    expect(failure(() => submit(regina, LAST_MONDAY))).toMatch(/RCM_INVALID: .*approved/);
  });

  it('locks the week\'s shift reports for the RCM once the weekly report is sent (admins can still fix them)', () => {
    save(regina, 330, ['onboarding']);
    submit(regina, LAST_MONDAY);
    expect(failure(() => save(regina, 300, ['onboarding']))).toMatch(/RCM_INVALID: .*weekly report/);
    expect(failure(() => db.exec({ id: regina }, `select delete_report('${shift}')`))).toMatch(/RCM_INVALID: .*weekly report/);
    save(lucia, 300, ['onboarding']);
    expect(db.value('super', `select worked_minutes from shift_reports where shift_id = '${shift}'`)).toBe(300);
  });

  it('shows RCMs only their own weekly reports; admins and viewers see all', () => {
    save(regina, 330, ['onboarding']);
    submit(regina, LAST_MONDAY);
    expect(db.value({ id: kris }, 'select count(*) from weekly_reports')).toBe(0);
    expect(db.value({ id: regina }, 'select count(*) from weekly_reports')).toBe(1);
    expect(db.value({ id: max }, 'select count(*) from weekly_reports')).toBe(1);
  });

  it('keeps future shifts out of reach', () => {
    const later = db.value<string>({ id: lucia }, `select book_shift(${nextWeek(0, 8)}, ${nextWeek(0, 10)}, '${regina}')`);
    expect(failure(() => save(regina, 60, ['onboarding'], '', [], later))).toMatch(/RCM_INVALID/);
  });
});
