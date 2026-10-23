import { describe, it, expect } from 'vitest';
import { handleAdminUsers, type AdminDeps } from '../../../backend/supabase/functions/_shared/admin_users.ts';
import { LOGIN_DOMAIN } from '../../../backend/supabase/functions/_shared/username.ts';

function fakeDeps(over: Partial<AdminDeps> = {}) {
  const calls: unknown[] = [];
  const deps: AdminDeps = {
    callerIsAdmin: async () => true,
    createUser: async (u) => { calls.push(['create', u]); return { id: 'new-id' }; },
    setPassword: async (id, pw) => { calls.push(['password', id, pw]); },
    setRole: async (id, role) => { calls.push(['role', id, role]); },
    ...over,
  };
  return { deps, calls };
}

describe('admin-users function', () => {
  it('creates a login from username, full name, password and role', async () => {
    const { deps, calls } = fakeDeps();
    const res = await handleAdminUsers({ action: 'create', username: ' Regina ', fullName: 'Regina Nemeth', password: 'shifts2026ok', role: 'rcm' }, deps);
    expect(res).toEqual({ status: 200, body: { id: 'new-id', username: 'regina' } });
    expect(calls).toEqual([['create', {
      email: `regina@${LOGIN_DOMAIN}`, password: 'shifts2026ok',
      user_metadata: { username: 'regina', full_name: 'Regina Nemeth' }, app_metadata: { role: 'rcm' },
    }], ['role', 'new-id', 'rcm']]);
  });

  it('creates read-only viewers (Max, Adrien)', async () => {
    const { deps, calls } = fakeDeps();
    const res = await handleAdminUsers({ action: 'create', username: 'max', fullName: 'Max', password: 'shifts2026ok', role: 'viewer' }, deps);
    expect(res.status).toBe(200);
    expect((calls[0] as [string, { app_metadata: unknown }])[1].app_metadata).toEqual({ role: 'viewer' });
    // Supabase adds app metadata after the insert, so the role is written explicitly afterwards.
    expect(calls[1]).toEqual(['role', 'new-id', 'viewer']);
  });

  it('reports a failure to set the role instead of leaving a wrong role silently', async () => {
    const { deps } = fakeDeps({ setRole: async () => { throw new Error('db down'); } });
    const res = await handleAdminUsers({ action: 'create', username: 'max', fullName: 'Max', password: 'shifts2026ok', role: 'viewer' }, deps);
    expect(res).toEqual({ status: 500, body: { error: 'The login max was created, but its role could not be set: db down. Set it from Team or the SQL editor.' } });
  });

  it('only admins may call it', async () => {
    const { deps, calls } = fakeDeps({ callerIsAdmin: async () => false });
    const res = await handleAdminUsers({ action: 'create', username: 'regina', fullName: 'R', password: 'shifts2026ok', role: 'rcm' }, deps);
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('validates input before touching Auth', async () => {
    const { deps, calls } = fakeDeps();
    expect(await handleAdminUsers({ action: 'create', username: 'r', fullName: 'R', password: 'shifts2026ok', role: 'rcm' }, deps))
      .toEqual({ status: 400, body: { error: 'Username must be 3 to 32 characters.' } });
    expect(await handleAdminUsers({ action: 'create', username: 'regina', fullName: 'R', password: 'short', role: 'rcm' }, deps))
      .toEqual({ status: 400, body: { error: 'Password must be at least 10 characters.' } });
    expect(await handleAdminUsers({ action: 'create', username: 'regina', fullName: '  ', password: 'shifts2026ok', role: 'rcm' }, deps))
      .toEqual({ status: 400, body: { error: 'Full name is required.' } });
    expect(await handleAdminUsers({ action: 'create', username: 'regina', fullName: 'R', password: 'shifts2026ok', role: 'boss' }, deps))
      .toEqual({ status: 400, body: { error: 'Role must be admin, rcm or viewer.' } });
    expect(await handleAdminUsers({ action: 'explode' }, deps)).toEqual({ status: 400, body: { error: 'Unknown action.' } });
    expect(calls).toHaveLength(0);
  });

  it('reports a taken username clearly', async () => {
    const { deps } = fakeDeps({ createUser: async () => { throw new Error('A user with this email address has already been registered'); } });
    expect(await handleAdminUsers({ action: 'create', username: 'regina', fullName: 'R', password: 'shifts2026ok', role: 'rcm' }, deps))
      .toEqual({ status: 409, body: { error: 'That username is already taken.' } });
  });

  it('resets a password', async () => {
    const { deps, calls } = fakeDeps();
    expect(await handleAdminUsers({ action: 'reset_password', userId: 'u1', password: 'newpass2026' }, deps)).toEqual({ status: 200, body: { ok: true } });
    expect(calls).toEqual([['password', 'u1', 'newpass2026']]);
  });
});
