import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestDb, failure, alwaysAvailable } from './db';

const T = (h: number) => `'2026-10-26T00:00:00Z'::timestamptz + interval '${h} hours'`;

// Max and Adrien see the whole board but cannot change anything.
describe('read-only viewers', () => {
  let db: TestDb;
  let lucia: string, regina: string, max: string;

  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('lucia', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    max = db.createUser('max', 'Max', 'viewer');
    alwaysAvailable(db, regina);
    db.exec({ id: regina }, `select book_shift(${T(8)}, ${T(10)}, null)`);
  });
  afterAll(() => db.drop());

  it('gets the viewer role from app metadata', () => {
    expect(db.value('super', `select role from profiles where id = '${max}'`)).toBe('viewer');
  });

  it('can read everything', () => {
    expect(db.value({ id: max }, 'select count(*) from shifts')).toBe(1);
    expect(db.value({ id: max }, 'select count(*) from shift_log')).toBe(1);
    expect(db.value({ id: max }, 'select count(*) from profiles')).toBe(3);
  });

  it('can still choose a time zone for the board', () => {
    db.exec({ id: max }, `select set_my_timezone('Europe/Paris')`);
    expect(db.value('super', `select timezone from profiles where id = '${max}'`)).toBe('Europe/Paris');
  });

  it('cannot book, change or take shifts', () => {
    const id = db.value<string>('super', 'select id from shifts limit 1');
    expect(failure(() => db.exec({ id: max }, `select book_shift(${T(12)}, ${T(14)}, null)`))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => db.exec({ id: max }, `select update_shift('${id}', ${T(8)}, ${T(9)}, null)`))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => db.exec({ id: max }, `select delete_shift('${id}')`))).toMatch(/RCM_FORBIDDEN/);
    db.exec({ id: regina }, `select ask_cover('${id}')`);
    expect(failure(() => db.exec({ id: max }, `select take_shift('${id}', null)`))).toMatch(/RCM_FORBIDDEN/);
    db.exec({ id: regina }, `select cancel_ask('${id}')`);
  });

  it('cannot change coverage or profiles', () => {
    expect(failure(() => db.exec({ id: max }, `select set_coverage('UTC', '{}'::jsonb)`))).toMatch(/RCM_FORBIDDEN/);
    expect(failure(() => db.exec({ id: max }, `select admin_update_profile('${max}', 'Max', 'admin', true)`))).toMatch(/RCM_FORBIDDEN/);
  });

  it('cannot be given shifts by an admin', () => {
    expect(failure(() => db.exec({ id: lucia }, `select book_shift(${T(20)}, ${T(21)}, '${max}')`))).toMatch(/RCM_INVALID/);
  });

  it('can be set by an admin, and roles stay within admin, rcm, viewer', () => {
    db.exec({ id: lucia }, `select admin_update_profile('${regina}', 'Regina Nemeth', 'viewer', true)`);
    expect(db.value('super', `select role from profiles where id = '${regina}'`)).toBe('viewer');
    db.exec({ id: lucia }, `select admin_update_profile('${regina}', 'Regina Nemeth', 'rcm', true)`);
    expect(failure(() => db.exec({ id: lucia }, `select admin_update_profile('${regina}', 'Regina', 'boss', true)`))).toMatch(/RCM_INVALID/);
  });
});
