import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDb, failure } from './db';

// Aram, 23 Oct 2026 (evening):
// - an RCM booking outside the required coverage OR outside their availability sends a request;
//   admins approve or reject it; no report until approved
// - no "ask for cover" on a shift that has started; RCMs cannot change or delete a shift of a past day
// - RCMs see only their own history; admins and viewers see everything; only admins delete entries
// - admins see changes as notifications and mark them as seen
const ts = (iso: string) => `'${iso}'::timestamptz`;
const day = (offsetDays: number, hourUtc: number) =>
  `date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '${offsetDays} days' + interval '${hourUtc} hours'`;

describe('requests, approvals and history by role', () => {
  let db: TestDb;
  let admin: string, regina: string, kris: string, max: string;

  beforeAll(() => {
    db = TestDb.create();
    admin = db.createUser('ladmin', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    kris = db.createUser('kris', 'Kris Arévalo');
    max = db.createUser('max', 'Max', 'viewer');
    for (const id of [regina, kris]) db.exec('super', `update profiles set timezone = 'UTC' where id = '${id}'`);
    // Regina: available every day 08:00–16:00 UTC. Required coverage: every day 10:00–14:00 UTC.
    const week = (s: number, e: number) => JSON.stringify(Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, [{ start: s * 60, end: e * 60 }]])));
    db.exec('super', `insert into availability (owner, days) values ('${regina}', '${week(8, 16)}'), ('${kris}', '${week(0, 24)}')`);
    db.exec('super', `insert into coverage (id, tz, days) values (1, 'UTC', '${week(10, 14)}')`);
  });
  afterAll(() => db.drop());
  beforeEach(() => db.exec('super', 'delete from shift_log; delete from shifts; delete from notification_seen;'));

  const book = (as: string, a: string, b: string, owner: string | null = null) =>
    db.value<string>({ id: as }, `select book_shift(${a}, ${b}, ${owner ? `'${owner}'` : 'null'})`);
  const status = (id: string) => db.value<string>('super', `select status from shifts where id = '${id}'`);
  const lastAction = () => db.value<string>('super', 'select action from shift_log order by id desc limit 1');

  describe('booking requests', () => {
    it('books directly inside both the required hours and the availability', () => {
      const id = book(regina, day(2, 10), day(2, 12));
      expect(status(id)).toBe('booked');
      expect(lastAction()).toBe('booked');
    });
    it('turns a booking outside the required hours into a request', () => {
      const id = book(regina, day(2, 14), day(2, 16));
      expect(status(id)).toBe('pending');
      expect(lastAction()).toBe('requested');
    });
    it('turns a booking outside the availability into a request', () => {
      const id = book(regina, day(2, 6), day(2, 9));
      expect(status(id)).toBe('pending');
    });
    it('books admin assignments directly', () => {
      expect(status(book(admin, day(2, 18), day(2, 20), regina))).toBe('booked');
    });
    it('keeps the slot reserved while the request waits', () => {
      book(regina, day(2, 14), day(2, 16));
      expect(failure(() => book(kris, day(2, 15), day(2, 17)))).toMatch(/RCM_OVERLAP/);
    });
    it('lets an admin approve or reject a request, and logs it', () => {
      const a = book(regina, day(2, 14), day(2, 16));
      db.exec({ id: admin }, `select approve_shift('${a}')`);
      expect(status(a)).toBe('booked');
      expect(lastAction()).toBe('approved');
      const r = book(regina, day(3, 14), day(3, 16));
      db.exec({ id: admin }, `select reject_shift('${r}')`);
      expect(db.value('super', `select count(*) from shifts where id = '${r}'`)).toBe(0);
      expect(lastAction()).toBe('rejected');
    });
    it('does not let RCMs or viewers approve', () => {
      const a = book(regina, day(2, 14), day(2, 16));
      expect(failure(() => db.exec({ id: regina }, `select approve_shift('${a}')`))).toMatch(/RCM_FORBIDDEN/);
      expect(failure(() => db.exec({ id: max }, `select reject_shift('${a}')`))).toMatch(/RCM_FORBIDDEN/);
    });
    it('blocks reports until the request is approved', () => {
      const a = book(regina, day(-1, 14), day(-1, 16));
      expect(status(a)).toBe('pending');
      expect(failure(() => db.exec({ id: regina }, `select save_report('${a}', 60, 'x', array['community'], '', '[]')`))).toMatch(/RCM_INVALID/);
      db.exec({ id: admin }, `select approve_shift('${a}')`);
      expect(() => db.exec({ id: regina }, `select save_report('${a}', 60, 'x', array['community'], '', '[]')`)).not.toThrow();
    });
  });

  describe('past and started shifts', () => {
    it('hides "ask for cover" once a shift has started', () => {
      const id = book(admin, day(0, 0), day(0, 20), regina); // started today (and under 24 h on clock-change days)
      expect(failure(() => db.exec({ id: regina }, `select ask_cover('${id}')`))).toMatch(/RCM_INVALID/);
    });
    it('stops RCMs from changing or deleting a shift of a past day, but not admins', () => {
      const id = book(admin, day(-2, 10), day(-2, 12), regina);
      expect(failure(() => db.exec({ id: regina }, `select delete_shift('${id}')`))).toMatch(/RCM_FORBIDDEN/);
      expect(failure(() => db.exec({ id: regina }, `select update_shift('${id}', ${day(-2, 10)}, ${day(-2, 11)}, null)`))).toMatch(/RCM_FORBIDDEN/);
      expect(() => db.exec({ id: admin }, `select delete_shift('${id}')`)).not.toThrow();
    });
  });

  describe('history by role', () => {
    it('shows RCMs only the entries that involve them', () => {
      book(regina, day(2, 10), day(2, 11));
      book(kris, day(2, 11), day(2, 12));
      expect(db.value({ id: regina }, 'select count(*) from shift_log')).toBe(1);
      expect(db.value({ id: kris }, 'select count(*) from shift_log')).toBe(1);
      expect(db.value({ id: admin }, 'select count(*) from shift_log')).toBe(2);
      expect(db.value({ id: max }, 'select count(*) from shift_log')).toBe(2);
    });
    it('lets only admins delete entries', () => {
      book(regina, day(2, 10), day(2, 11));
      const id = db.value<number>('super', 'select id from shift_log limit 1');
      expect(failure(() => db.exec({ id: max }, `select delete_log(${id})`))).toMatch(/RCM_FORBIDDEN/);
      expect(failure(() => db.exec({ id: regina }, `select delete_log(${id})`))).toMatch(/RCM_FORBIDDEN/);
      db.exec({ id: admin }, `select delete_log(${id})`);
      expect(db.value('super', 'select count(*) from shift_log')).toBe(0);
    });
  });

  describe('notifications for admins', () => {
    it('remembers when each admin last looked', () => {
      expect(db.value({ id: admin }, 'select count(*) from notification_seen')).toBe(0);
      db.exec({ id: admin }, 'select mark_notifications_seen()');
      expect(db.value({ id: admin }, 'select seen_at is not null from notification_seen')).toBe(true);
      expect(failure(() => db.exec({ id: regina }, 'select mark_notifications_seen()'))).toMatch(/RCM_FORBIDDEN/);
    });
  });
  void ts;
});
