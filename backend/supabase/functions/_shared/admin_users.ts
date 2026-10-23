// Core of the admin-users Edge Function, kept free of Deno and Supabase imports so
// it can be unit-tested. index.ts wires it to Supabase Auth.
import { normalizeUsername, usernameToEmail, validatePassword, validateUsername } from './username.ts';

export type NewUser = {
  email: string;
  password: string;
  user_metadata: { username: string; full_name: string };
  app_metadata: { role: 'admin' | 'rcm' | 'viewer' };
};

export type AdminDeps = {
  callerIsAdmin: () => Promise<boolean>;
  createUser: (u: NewUser) => Promise<{ id: string }>;
  setPassword: (userId: string, password: string) => Promise<void>;
};

export type Result = { status: number; body: Record<string, unknown> };

const bad = (error: string, status = 400): Result => ({ status, body: { error } });

export async function handleAdminUsers(input: Record<string, unknown>, deps: AdminDeps): Promise<Result> {
  const action = input && input.action;
  if (action !== 'create' && action !== 'reset_password') return bad('Unknown action.');
  if (!(await deps.callerIsAdmin())) return bad('Only admins can manage logins.', 403);

  if (action === 'create') {
    const username = normalizeUsername(String(input.username ?? ''));
    const fullName = String(input.fullName ?? '').trim();
    const password = String(input.password ?? '');
    const role = input.role;
    const uErr = validateUsername(username);
    if (uErr) return bad(uErr);
    if (!fullName) return bad('Full name is required.');
    if (fullName.length > 80) return bad('Full name is too long.');
    const pErr = validatePassword(password);
    if (pErr) return bad(pErr);
    if (role !== 'admin' && role !== 'rcm' && role !== 'viewer') return bad('Role must be admin, rcm or viewer.');
    try {
      const { id } = await deps.createUser({
        email: usernameToEmail(username), password,
        user_metadata: { username, full_name: fullName }, app_metadata: { role },
      });
      return { status: 200, body: { id, username } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already (been )?registered|already exists|duplicate/i.test(msg)) return bad('That username is already taken.', 409);
      return bad('Could not create the login: ' + msg, 500);
    }
  }

  const userId = String(input.userId ?? '');
  const password = String(input.password ?? '');
  if (!userId) return bad('Missing userId.');
  const pErr = validatePassword(password);
  if (pErr) return bad(pErr);
  try {
    await deps.setPassword(userId, password);
    return { status: 200, body: { ok: true } };
  } catch (e) {
    return bad('Could not reset the password: ' + (e instanceof Error ? e.message : String(e)), 500);
  }
}
