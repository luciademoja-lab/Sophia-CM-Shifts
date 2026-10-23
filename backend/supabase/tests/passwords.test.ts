import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestDb, failure } from './db';

// Admin passwords can be changed straight from the Supabase SQL editor:
//   select set_password('ladmin', 'new-password-2026');
describe('set_password (from the SQL editor)', () => {
  let db: TestDb;
  let ladmin: string;

  beforeAll(() => {
    db = TestDb.create();
    ladmin = db.createUser('ladmin', 'Lucia De Mojà', 'admin');
    db.createUser('regina', 'Regina Nemeth');
  });
  afterAll(() => db.drop());

  const matches = (id: string, pw: string) =>
    db.value<boolean>('super', `select encrypted_password = extensions.crypt('${pw}', encrypted_password) from auth.users where id = '${id}'`);

  it('sets a bcrypt hash that Supabase Auth accepts, by username', () => {
    expect(db.value('super', `select set_password('ladmin', 'shifts2026ok')`)).toBe('Password updated for ladmin.');
    expect(matches(ladmin, 'shifts2026ok')).toBe(true);
    expect(matches(ladmin, 'something-else-1')).toBe(false);
    expect(db.value<string>('super', `select encrypted_password from auth.users where id = '${ladmin}'`)).toMatch(/^\$2[aby]\$/);
  });

  it('accepts the username in any case and with spaces', () => {
    db.exec('super', `select set_password(' LAdmin ', 'another2026pw')`);
    expect(matches(ladmin, 'another2026pw')).toBe(true);
  });

  it('confirms the login, so a user added by SQL can sign in right away', () => {
    expect(db.value('super', `select email_confirmed_at is not null from auth.users where id = '${ladmin}'`)).toBe(true);
  });

  it('applies the same password rules as the app', () => {
    expect(failure(() => db.exec('super', `select set_password('ladmin', 'short1')`))).toMatch(/at least 10 characters/);
    expect(failure(() => db.exec('super', `select set_password('ladmin', 'onlyletters')`))).toMatch(/letter and one number/);
  });

  it('says clearly when the username does not exist', () => {
    expect(failure(() => db.exec('super', `select set_password('nobody', 'shifts2026ok')`))).toMatch(/no login with username nobody/);
  });

  it('cannot be called from the app, only from the SQL editor', () => {
    expect(failure(() => db.exec({ id: ladmin }, `select set_password('regina', 'hijack2026pw')`))).toMatch(/permission denied/);
    expect(failure(() => db.exec('anon', `select set_password('regina', 'hijack2026pw')`))).toMatch(/permission denied/);
  });
});
