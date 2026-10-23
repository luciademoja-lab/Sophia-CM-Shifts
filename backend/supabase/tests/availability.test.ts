import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDb, failure } from './db';

// RCMs declare a usual week plus day exceptions, in their own time zone.
// RCMs can only book or take shifts inside their availability; admins can assign anywhere.
const ts = (iso: string) => `'${iso}'::timestamptz`;

describe('availability', () => {
  let db: TestDb;
  let lucia: string, regina: string, kris: string, max: string;

  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('ladmin', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    kris = db.createUser('kris', 'Kris Arévalo');
    max = db.createUser('max', 'Max', 'viewer');
    db.exec({ id: regina }, `select set_my_timezone('Europe/Budapest')`);
    db.exec({ id: kris }, `select set_my_timezone('America/Bogota')`);
  });
  afterAll(() => db.drop());
  beforeEach(() => db.exec('super', 'delete from shift_log; delete from shifts; delete from availability_days; delete from availability;'));

  const week = (as: string, days: unknown, owner: string | null = null) =>
    db.exec({ id: as }, `select set_availability('${JSON.stringify(days)}'::jsonb, ${owner ? `'${owner}'` : 'null'})`);
  const day = (as: string, date: string, slots: unknown, owner: string | null = null) =>
    db.exec({ id: as }, `select set_availability_day('${date}'::date, ${slots === null ? 'null' : `'${JSON.stringify(slots)}'::jsonb`}, ${owner ? `'${owner}'` : 'null'})`);
  const avail = (owner: string, a: string, b: string) => db.value<boolean>('super', `select public._is_available('${owner}', ${ts(a)}, ${ts(b)})`);
  const book = (as: string, a: string, b: string, owner: string | null = null) =>
    db.value<string>({ id: as }, `select book_shift(${ts(a)}, ${ts(b)}, ${owner ? `'${owner}'` : 'null'})`);

  it('saves the usual week, sorted and validated like coverage slots', () => {
    week(regina, { 1: [{ start: 840, end: 1080 }, { start: 480, end: 720 }] });
    expect(db.value('super', `select days from availability where owner = '${regina}'`)).toEqual({ 1: [{ start: 480, end: 720 }, { start: 840, end: 1080 }] });
    expect(failure(() => week(regina, { 1: [{ start: 480, end: 900 }, { start: 840, end: 1080 }] }))).toMatch(/RCM_INVALID/);
  });

  it('reads the usual week in the RCM time zone, across midnight and DST', () => {
    week(regina, { 1: [{ start: 480, end: 720 }], 3: [{ start: 1080, end: 1440 }], 4: [{ start: 0, end: 120 }], 7: [{ start: 540, end: 660 }] });
    expect(avail(regina, '2026-10-19T06:00Z', '2026-10-19T10:00Z')).toBe(true); // Mon 08–12 Budapest
    expect(avail(regina, '2026-10-19T09:00Z', '2026-10-19T11:00Z')).toBe(false);
    expect(avail(regina, '2026-10-21T20:00Z', '2026-10-21T23:00Z')).toBe(true); // Wed 22:00 → Thu 01:00
    expect(avail(regina, '2026-10-25T08:00Z', '2026-10-25T10:00Z')).toBe(true); // Sun after DST ends
  });

  it('lets a day exception replace, clear or add hours, and removing it restores the usual day', () => {
    week(regina, { 1: [{ start: 480, end: 720 }] });
    day(regina, '2026-10-19', []);
    expect(avail(regina, '2026-10-19T06:00Z', '2026-10-19T07:00Z')).toBe(false);
    day(regina, '2026-10-19', [{ start: 840, end: 960 }]);
    expect(avail(regina, '2026-10-19T12:00Z', '2026-10-19T14:00Z')).toBe(true);
    day(regina, '2026-10-20', [{ start: 600, end: 660 }]);
    expect(avail(regina, '2026-10-20T08:00Z', '2026-10-20T09:00Z')).toBe(true);
    day(regina, '2026-10-19', null);
    expect(avail(regina, '2026-10-19T06:00Z', '2026-10-19T10:00Z')).toBe(true);
  });

  it('is readable by everyone signed in and editable only by the RCM or an admin', () => {
    week(regina, { 1: [{ start: 480, end: 720 }] });
    expect(db.value({ id: max }, 'select count(*) from availability')).toBe(1);
    expect(failure(() => week(kris, { 1: [] }, regina))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => week(max, { 1: [] }))).toMatch(/RCM_FORBIDDEN/);
    week(lucia, { 2: [{ start: 600, end: 720 }] }, regina);
    expect(db.value('super', `select days from availability where owner = '${regina}'`)).toEqual({ 2: [{ start: 600, end: 720 }] });
    expect(failure(() => db.exec({ id: regina }, `delete from availability`))).toMatch(/permission denied/);
  });

  // Booking rules use a UTC RCM and next week's Monday, so they keep working whatever today is.
  const mon = (h: number) => `(date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' + interval '7 days' + interval '${h} hours')`;
  const bookAt = (as: string, a: number, b: number, owner: string | null = null) =>
    db.value<string>({ id: as }, `select book_shift(${mon(a)}, ${mon(b)}, ${owner ? `'${owner}'` : 'null'})`);
  const status = (id: string) => db.value('super', `select status from shifts where id = '${id}'`);
  const utcRcm = () => { db.exec('super', `update profiles set timezone = 'UTC' where id in ('${regina}', '${kris}')`); };

  it('books RCMs directly inside their availability, and as a request outside it', () => {
    utcRcm();
    week(regina, { 1: [{ start: 480, end: 720 }] });
    expect(status(bookAt(regina, 8, 10))).toBe('booked');
    expect(status(bookAt(regina, 11, 13))).toBe('pending');
  });

  it('lets admins assign outside availability (the app warns them)', () => {
    utcRcm();
    expect(status(bookAt(lucia, 20, 22, regina))).toBe('booked');
  });

  it('turns an RCM move outside availability into a request', () => {
    utcRcm();
    week(regina, { 1: [{ start: 480, end: 720 }] });
    const id = bookAt(regina, 8, 10);
    db.exec({ id: regina }, `select update_shift('${id}', ${mon(10)}, ${mon(13)}, null)`);
    expect(status(id)).toBe('pending');
  });

  it('lets RCMs take a shift needing cover only inside their availability', () => {
    utcRcm();
    week(regina, { 1: [{ start: 480, end: 720 }] });
    const id = bookAt(regina, 8, 10);
    db.exec({ id: regina }, `select ask_cover('${id}')`);
    expect(failure(() => db.exec({ id: kris }, `select take_shift('${id}', null)`))).toMatch(/RCM_UNAVAILABLE/);
    week(kris, { 1: [{ start: 360, end: 720 }] });
    expect(() => db.exec({ id: kris }, `select take_shift('${id}', null)`)).not.toThrow();
    db.exec('super', `update profiles set timezone = 'Europe/Budapest' where id = '${regina}'; update profiles set timezone = 'America/Bogota' where id = '${kris}'`);
  });
});
