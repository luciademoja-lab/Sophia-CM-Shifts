import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDb, failure, alwaysAvailable } from './db';

// RCMs book only in the current and next week (Mon–Sun, their time zone); on Sundays the week after opens too.
const weekAt = (w: number, h: number) => `(date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' + interval '${w * 7} days' + interval '${h} hours')`;

describe('booking window', () => {
  let db: TestDb;
  let lucia: string, regina: string;
  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('ladmin', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    alwaysAvailable(db, regina); // UTC
  });
  afterAll(() => db.drop());
  beforeEach(() => db.exec('super', 'delete from shift_log; delete from shifts;'));
  const book = (as: string, w: number, owner: string | null = null) =>
    db.value<string>({ id: as }, `select book_shift(${weekAt(w, 30)}, ${weekAt(w, 32)}, ${owner ? `'${owner}'` : 'null'})`);
  const sunday = db_isSunday;
  function db_isSunday(): boolean { return db.value<number>('super', `select extract(isodow from now() at time zone 'UTC')::int`) === 7; }

  it('lets RCMs book this week and next week', () => {
    expect(() => book(regina, 0)).not.toThrow();
    expect(() => book(regina, 1)).not.toThrow();
  });
  it('keeps later weeks closed until Sunday, and earlier weeks closed', () => {
    if (sunday()) expect(() => book(regina, 2)).not.toThrow();
    else expect(failure(() => book(regina, 2))).toMatch(/RCM_INVALID: .*this week and next week/);
    expect(failure(() => book(regina, 3))).toMatch(/RCM_INVALID/);
    expect(failure(() => book(regina, -1))).toMatch(/RCM_INVALID/);
  });
  it('does not limit admins', () => {
    expect(() => book(lucia, 4, regina)).not.toThrow();
  });
});
