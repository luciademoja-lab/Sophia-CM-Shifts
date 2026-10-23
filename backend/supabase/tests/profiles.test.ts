import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestDb, failure } from './db';

describe('profiles', () => {
  let db: TestDb;
  let lucia: string, regina: string, kris: string;

  beforeAll(() => {
    db = TestDb.create();
    lucia = db.createUser('lucia', 'Lucia De Mojà', 'admin');
    regina = db.createUser('regina', 'Regina Nemeth');
    kris = db.createUser('kris', 'Kris Arévalo');
  });
  afterAll(() => db.drop());

  it('creates a profile for every new login, with no time zone yet', () => {
    expect(db.rows('super', `select username, full_name, role, timezone, active from profiles where id = '${regina}'`)).toEqual([
      { username: 'regina', full_name: 'Regina Nemeth', role: 'rcm', timezone: null, active: true },
    ]);
  });

  it('takes the role only from app metadata, which users cannot change', () => {
    expect(db.value('super', `select role from profiles where id = '${lucia}'`)).toBe('admin');
  });

  it('lets signed-in users see the team, and hides it from anonymous visitors', () => {
    expect(db.value({ id: regina }, 'select count(*) from profiles')).toBe(3);
    expect(failure(() => db.rows('anon', 'select * from profiles'))).toMatch(/permission denied/);
  });

  it('does not let users edit profiles directly', () => {
    expect(failure(() => db.exec({ id: regina }, `update profiles set role = 'admin' where id = '${regina}'`))).toMatch(/permission denied/);
    expect(db.value('super', `select role from profiles where id = '${regina}'`)).toBe('rcm');
  });

  describe('set_my_timezone (chosen by the RCM at first login)', () => {
    it('saves a valid zone on the caller\'s own profile', () => {
      db.exec({ id: regina }, `select set_my_timezone('Europe/Budapest')`);
      expect(db.value('super', `select timezone from profiles where id = '${regina}'`)).toBe('Europe/Budapest');
      expect(db.value('super', `select timezone from profiles where id = '${kris}'`)).toBeNull();
    });
    it('rejects unknown zones', () => {
      expect(failure(() => db.exec({ id: kris }, `select set_my_timezone('Mars/Olympus')`))).toMatch(/RCM_INVALID/);
    });
    it('requires a signed-in user', () => {
      expect(failure(() => db.exec('anon', `select set_my_timezone('UTC')`))).toMatch(/permission denied|RCM_NOT_SIGNED_IN/);
    });
  });

  describe('is_admin', () => {
    it('is true only for active admins', () => {
      expect(db.value({ id: lucia }, 'select is_admin()')).toBe(true);
      expect(db.value({ id: regina }, 'select is_admin()')).toBe(false);
    });
  });

  describe('admin_update_profile', () => {
    it('lets an admin rename, promote and deactivate people', () => {
      db.exec({ id: lucia }, `select admin_update_profile('${kris}', 'Kris A.', 'rcm', false)`);
      expect(db.rows('super', `select full_name, role, active from profiles where id = '${kris}'`)).toEqual([{ full_name: 'Kris A.', role: 'rcm', active: false }]);
      db.exec({ id: lucia }, `select admin_update_profile('${kris}', 'Kris Arévalo', 'rcm', true)`);
    });
    it('refuses non-admins', () => {
      expect(failure(() => db.exec({ id: regina }, `select admin_update_profile('${regina}', 'R', 'admin', true)`))).toMatch(/RCM_FORBIDDEN/);
    });
    it('stops admins from removing their own admin access', () => {
      expect(failure(() => db.exec({ id: lucia }, `select admin_update_profile('${lucia}', 'Lucia', 'rcm', true)`))).toMatch(/RCM_INVALID/);
    });
  });
});
