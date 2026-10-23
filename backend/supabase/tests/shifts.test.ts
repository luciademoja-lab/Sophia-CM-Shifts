import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestDb, failure } from './db';

const T = (h: number) => `'2026-10-26T00:00:00Z'::timestamptz + interval '${h} hours'`;

describe('shifts', () => {
  let db: TestDb;
  let lucia: string, regina: string, kris: string, gone: string;

  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('lucia', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    kris = db.createUser('kris', 'Kris Arévalo');
    gone = db.createUser('gone', 'Former RCM');
    db.exec({ id: lucia }, `select admin_update_profile('${gone}', 'Former RCM', 'rcm', false)`);
  });
  afterAll(() => db.drop());
  beforeEach(() => db.exec('super', 'delete from shift_log; delete from shifts;'));

  const book = (as: string, startH: number, endH: number, owner: string | null = null) =>
    db.value<string>({ id: as }, `select book_shift(${T(startH)}, ${T(endH)}, ${owner ? `'${owner}'` : 'null'})`);
  const shift = (id: string) => db.rows('super', `select owner, status, covers_id, extract(epoch from ends_at - starts_at)/3600 as hours from shifts where id = '${id}'`)[0];
  const log = () => db.rows('super', `select action, actor, owner, from_owner from shift_log order by at, id`);

  describe('book_shift', () => {
    it('books availability for yourself and logs it', () => {
      const id = book(regina, 8, 10);
      expect(shift(id)).toEqual({ owner: regina, status: 'booked', covers_id: null, hours: 2 });
      expect(log()).toEqual([{ action: 'booked', actor: regina, owner: regina, from_owner: null }]);
    });
    it('allows only one RCM per slot', () => {
      book(regina, 8, 10);
      expect(failure(() => book(kris, 9, 11))).toMatch(/RCM_OVERLAP/);
      expect(() => book(kris, 10, 12)).not.toThrow();
    });
    it('is backed by a database constraint, so two simultaneous bookings cannot both win', () => {
      book(regina, 8, 10);
      expect(failure(() => db.exec('super', `insert into shifts (owner, starts_at, ends_at) values ('${kris}', ${T(9)}, ${T(11)})`))).toMatch(/shifts_one_rcm_per_slot/);
    });
    it('rejects shifts that end before they start or last over a day', () => {
      expect(failure(() => book(regina, 10, 10))).toMatch(/RCM_INVALID/);
      expect(failure(() => book(regina, 0, 25))).toMatch(/RCM_INVALID/);
    });
    it('lets an admin book for an RCM, but not RCMs for each other', () => {
      const id = book(lucia, 8, 10, kris);
      expect(shift(id).owner).toBe(kris);
      expect(failure(() => book(regina, 12, 14, kris))).toMatch(/RCM_FORBIDDEN/);
    });
    it('refuses deactivated logins and anonymous visitors', () => {
      expect(failure(() => book(gone, 8, 10))).toMatch(/RCM_FORBIDDEN/);
      expect(failure(() => book(lucia, 8, 10, gone))).toMatch(/RCM_INVALID/);
      expect(failure(() => db.exec('anon', `select book_shift(${T(1)}, ${T(2)}, null)`))).toMatch(/permission denied|RCM_NOT_SIGNED_IN/);
    });
    it('does not allow writing to the tables directly', () => {
      expect(failure(() => db.exec({ id: regina }, `insert into shifts (owner, starts_at, ends_at) values ('${regina}', ${T(1)}, ${T(2)})`))).toMatch(/permission denied/);
      expect(failure(() => db.exec({ id: regina }, `delete from shift_log`))).toMatch(/permission denied/);
    });
    it('lets every signed-in user read the board', () => {
      book(regina, 8, 10);
      expect(db.value({ id: kris }, 'select count(*) from shifts')).toBe(1);
      expect(db.value({ id: kris }, 'select count(*) from shift_log')).toBe(1);
    });
  });

  describe('update_shift', () => {
    it('lets the owner move a shift, checking overlaps against others only', () => {
      const id = book(regina, 8, 10);
      book(kris, 12, 14);
      db.exec({ id: regina }, `select update_shift('${id}', ${T(9)}, ${T(11)}, null)`);
      expect(shift(id).hours).toBe(2);
      expect(failure(() => db.exec({ id: regina }, `select update_shift('${id}', ${T(11)}, ${T(13)}, null)`))).toMatch(/RCM_OVERLAP/);
      expect(log().map((l) => l.action)).toEqual(['booked', 'booked', 'edited']);
    });
    it('stops other RCMs, lets admins reassign', () => {
      const id = book(regina, 8, 10);
      expect(failure(() => db.exec({ id: kris }, `select update_shift('${id}', ${T(8)}, ${T(9)}, null)`))).toMatch(/RCM_FORBIDDEN/);
      db.exec({ id: lucia }, `select update_shift('${id}', ${T(8)}, ${T(10)}, '${kris}')`);
      expect(shift(id).owner).toBe(kris);
    });
  });

  describe('cover requests', () => {
    it('ask_cover marks a shift as needing cover, cancel_ask withdraws it', () => {
      const id = book(regina, 8, 10);
      db.exec({ id: regina }, `select ask_cover('${id}')`);
      expect(shift(id).status).toBe('open');
      db.exec({ id: regina }, `select cancel_ask('${id}')`);
      expect(shift(id).status).toBe('booked');
      expect(log().map((l) => l.action)).toEqual(['booked', 'ask', 'cancelask']);
    });
    it('take_shift hands the slot to the taker in one step', () => {
      const id = book(regina, 8, 10);
      db.exec({ id: regina }, `select ask_cover('${id}')`);
      const cover = db.value<string>({ id: kris }, `select take_shift('${id}', null)`);
      expect(shift(id).status).toBe('covered');
      expect(shift(cover)).toEqual({ owner: kris, status: 'booked', covers_id: id, hours: 2 });
      expect(log().pop()).toEqual({ action: 'took', actor: kris, owner: kris, from_owner: regina });
    });
    it('only open shifts can be taken, and not by their owner', () => {
      const id = book(regina, 8, 10);
      expect(failure(() => db.exec({ id: kris }, `select take_shift('${id}', null)`))).toMatch(/RCM_INVALID/);
      db.exec({ id: regina }, `select ask_cover('${id}')`);
      expect(failure(() => db.exec({ id: regina }, `select take_shift('${id}', null)`))).toMatch(/RCM_INVALID/);
    });
    it('an admin can give an open shift to someone', () => {
      const id = book(regina, 8, 10);
      db.exec({ id: regina }, `select ask_cover('${id}')`);
      const cover = db.value<string>({ id: lucia }, `select take_shift('${id}', '${kris}')`);
      expect(shift(cover).owner).toBe(kris);
      expect(log().pop()).toEqual({ action: 'took', actor: lucia, owner: kris, from_owner: regina });
    });
    it('cover shifts cannot themselves be put up for cover', () => {
      const id = book(regina, 8, 10);
      db.exec({ id: regina }, `select ask_cover('${id}')`);
      const cover = db.value<string>({ id: kris }, `select take_shift('${id}', null)`);
      expect(failure(() => db.exec({ id: kris }, `select ask_cover('${cover}')`))).toMatch(/RCM_INVALID/);
    });
  });

  describe('delete_shift', () => {
    it('deletes your own shift and logs it', () => {
      const id = book(regina, 8, 10);
      db.exec({ id: regina }, `select delete_shift('${id}')`);
      expect(db.value('super', 'select count(*) from shifts')).toBe(0);
      expect(log().pop()?.action).toBe('deleted');
    });
    it('giving back a cover shift puts the original back up for cover', () => {
      const id = book(regina, 8, 10);
      db.exec({ id: regina }, `select ask_cover('${id}')`);
      const cover = db.value<string>({ id: kris }, `select take_shift('${id}', null)`);
      db.exec({ id: kris }, `select delete_shift('${cover}')`);
      expect(shift(id).status).toBe('open');
      expect(log().pop()?.action).toBe('gaveback');
    });
    it('refuses other RCMs and hidden (covered) shifts', () => {
      const id = book(regina, 8, 10);
      expect(failure(() => db.exec({ id: kris }, `select delete_shift('${id}')`))).toMatch(/RCM_FORBIDDEN/);
      db.exec({ id: regina }, `select ask_cover('${id}')`);
      db.value({ id: kris }, `select take_shift('${id}', null)`);
      expect(failure(() => db.exec({ id: regina }, `select delete_shift('${id}')`))).toMatch(/RCM_INVALID/);
    });
    it('restoring after an undo is logged as restored', () => {
      db.value({ id: regina }, `select book_shift(${T(8)}, ${T(10)}, null, true)`);
      expect(log().pop()?.action).toBe('restored');
    });
  });
});
