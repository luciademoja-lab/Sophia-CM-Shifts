import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDb, failure, alwaysAvailable } from './db';

// RCMs log what they did in a shift and the hours actually worked, which can be
// more or less than the booked slot. The shift owner and admins can edit it.
const past = (h: number) => `date_trunc('hour', now()) - interval '2 days' + interval '${h} hours'`;
const future = (h: number) => `date_trunc('hour', now()) + interval '2 days' + interval '${h} hours'`;

describe('shift reports', () => {
  let db: TestDb;
  let lucia: string, regina: string, kris: string, max: string;
  let shift: string;

  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('lucia', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    kris = db.createUser('kris', 'Kris Arévalo');
    max = db.createUser('max', 'Max', 'viewer');
    alwaysAvailable(db, regina, kris);
  });
  afterAll(() => db.drop());
  beforeEach(() => {
    db.exec('super', 'delete from shift_reports; delete from shift_log; delete from shifts;');
    shift = db.value<string>({ id: regina }, `select book_shift(${past(8)}, ${past(11)}, null)`);
  });

  const save = (as: string, minutes: number, notes: string, id = shift) =>
    db.exec({ id: as }, `select save_report('${id}', ${minutes}, '${notes.replace(/'/g, "''")}', array['community'], '', '[]')`);
  const report = () => db.rows('super', `select owner, worked_minutes, notes, updated_by from shift_reports where shift_id = '${shift}'`)[0];

  it('lets the RCM report hours worked and what they did, even more or less than booked', () => {
    save(regina, 150, 'Answered #zone-a, onboarded 3 posters');
    expect(report()).toEqual({ owner: regina, worked_minutes: 150, notes: 'Answered #zone-a, onboarded 3 posters', updated_by: regina });
    save(regina, 200, 'Stayed longer for the Monday payments');
    expect(report()).toMatchObject({ worked_minutes: 200, notes: 'Stayed longer for the Monday payments' });
  });

  it('writes the report into the history', () => {
    save(regina, 150, 'x');
    expect(db.rows('super', `select action, actor, owner, shift_id from shift_log order by id`).pop()).toEqual({ action: 'reported', actor: regina, owner: regina, shift_id: shift });
  });

  it('lets admins edit any report', () => {
    save(regina, 150, 'x');
    save(lucia, 120, 'Corrected: left at 10:00');
    expect(report()).toMatchObject({ worked_minutes: 120, updated_by: lucia });
  });

  it('refuses other RCMs and viewers', () => {
    expect(failure(() => save(kris, 60, 'not mine'))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => save(max, 60, 'read only'))).toMatch(/RCM_FORBIDDEN/);
  });

  it('only accepts shifts that have started', () => {
    const later = db.value<string>({ id: regina }, `select book_shift(${future(8)}, ${future(10)}, null)`);
    expect(failure(() => save(regina, 60, 'too early', later))).toMatch(/RCM_INVALID/);
  });

  it('validates the hours', () => {
    expect(failure(() => save(regina, -5, 'x'))).toMatch(/RCM_INVALID/);
    expect(failure(() => save(regina, 24 * 60 + 5, 'x'))).toMatch(/RCM_INVALID/);
  });

  it('is readable by everyone signed in, including viewers', () => {
    save(regina, 150, 'x');
    expect(db.value({ id: max }, 'select count(*) from shift_reports')).toBe(1);
    expect(failure(() => db.rows('anon', 'select * from shift_reports'))).toMatch(/permission denied/);
    expect(failure(() => db.exec({ id: regina }, `update shift_reports set worked_minutes = 1`))).toMatch(/permission denied/);
  });

  it('can be removed by the owner, and goes away with its shift', () => {
    save(regina, 150, 'x');
    db.exec({ id: regina }, `select delete_report('${shift}')`);
    expect(db.value('super', 'select count(*) from shift_reports')).toBe(0);
    save(regina, 150, 'x');
    db.exec({ id: lucia }, `select delete_shift('${shift}')`); // past day: only an admin can delete it
    expect(db.value('super', 'select count(*) from shift_reports')).toBe(0);
  });

  it('is not possible on a shift that someone else took over', () => {
    // cover is asked before the shift starts; move the pair into the past afterwards
    const later = db.value<string>({ id: regina }, `select book_shift(${future(8)}, ${future(11)}, null)`);
    db.exec('super', `delete from shifts where id = '${shift}'`);
    shift = later;
    db.exec({ id: regina }, `select ask_cover('${shift}')`);
    const cover = db.value<string>({ id: kris }, `select take_shift('${shift}', null)`);
    db.exec('super', `update shifts set starts_at = starts_at - interval '4 days', ends_at = ends_at - interval '4 days'`);
    expect(failure(() => save(regina, 60, 'x'))).toMatch(/RCM_INVALID/);
    save(kris, 180, 'Covered for Regina', cover);
    expect(db.value('super', `select owner from shift_reports where shift_id = '${cover}'`)).toBe(kris);
  });
});
