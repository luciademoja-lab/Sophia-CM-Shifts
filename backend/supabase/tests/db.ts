// Helpers for database tests: each test file gets a fresh database with the
// migrations applied, and runs queries as a given signed-in user through RLS.
//
// DATABASE_URL must point at a Postgres the tests may create databases on.
// With the Supabase CLI running (`npm run db:start`) the default below works.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = process.env.PROJECT_ROOT
  ? join(process.env.PROJECT_ROOT, 'backend/supabase')
  : join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function psql(url: string, sql: string): string {
  const r = spawnSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const msg = (r.stderr || '').split('\n').find((l) => l.startsWith('ERROR:')) || r.stderr;
    throw new Error(msg.replace(/^ERROR:\s*/, '').trim());
  }
  return r.stdout.trim();
}

export type As = 'anon' | 'super' | { id: string };

export class TestDb {
  readonly url: string;
  private constructor(readonly name: string) {
    const u = new URL(BASE_URL);
    u.pathname = '/' + name;
    this.url = u.toString();
  }

  static create(): TestDb {
    const db = new TestDb('rcm_test_' + randomUUID().slice(0, 8));
    psql(BASE_URL, `create database ${db.name};`);
    psql(db.url, readFileSync(join(ROOT, 'tests/auth_stub.sql'), 'utf8'));
    const dir = join(ROOT, 'migrations');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) psql(db.url, readFileSync(join(dir, f), 'utf8'));
    return db;
  }

  drop(): void {
    psql(BASE_URL, `drop database if exists ${this.name} with (force);`);
  }

  private wrap(as: As, sql: string): string {
    if (as === 'super') return sql;
    const claims = as === 'anon' ? '{"role":"anon"}' : JSON.stringify({ sub: as.id, role: 'authenticated' });
    const role = as === 'anon' ? 'anon' : 'authenticated';
    return `begin;\nset local role ${role};\nselect set_config('request.jwt.claims', '${claims}', true) \\g /dev/null\n${sql}\ncommit;`;
  }

  /** Runs statements; throws with the Postgres error message on failure. */
  exec(as: As, sql: string): string {
    return psql(this.url, this.wrap(as, sql.trim().replace(/;?$/, ';')));
  }

  /** Runs one SELECT and returns its rows as objects. */
  rows<T = Record<string, unknown>>(as: As, select: string): T[] {
    const out = this.exec(as, `select coalesce(json_agg(t), '[]') from (${select.trim().replace(/;$/, '')}) t`);
    return JSON.parse(out || '[]');
  }

  /** Runs one SELECT returning a single value. */
  value<T = unknown>(as: As, select: string): T {
    const r = this.rows<Record<string, T>>(as, select);
    return r.length ? Object.values(r[0])[0] : (undefined as T);
  }

  /** Creates a sign-in user the way the admin-users function does (service role). */
  createUser(username: string, fullName: string, role: 'admin' | 'rcm' | 'viewer' = 'rcm'): string {
    const id = randomUUID();
    psql(this.url, `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values (
      '${id}', '${username}@rcm.vikstudios.com',
      '${JSON.stringify({ username, full_name: fullName }).replace(/'/g, "''")}',
      '${JSON.stringify({ role })}');`);
    return id;
  }
}

/** Expects a statement to fail with a message containing `fragment`. */
export function failure(fn: () => unknown): string {
  try { fn(); } catch (e) { return (e as Error).message; }
  throw new Error('expected the statement to fail');
}
