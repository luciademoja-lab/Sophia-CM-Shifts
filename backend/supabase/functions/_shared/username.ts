// Login rules shared by the app (browser) and the admin-users Edge Function (Deno).
// RCMs sign in with a username; Supabase Auth needs an email, so each username maps
// to an internal address on LOGIN_DOMAIN. No email is ever sent to it.

export const LOGIN_DOMAIN = 'rcm.vikstudios.com';

export function normalizeUsername(u: string): string {
  return (u || '').trim().toLowerCase();
}

export function validateUsername(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (u.length < 3 || u.length > 32) return 'Username must be 3 to 32 characters.';
  if (!/^[a-z0-9._-]+$/.test(u)) return 'Use only letters, numbers, dots, dashes and underscores.';
  if (!/^[a-z0-9]/.test(u)) return 'Start with a letter or a number.';
  return null;
}

export function validatePassword(p: string): string | null {
  if (!p || p.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password needs at least one letter and one number.';
  return null;
}

export function usernameToEmail(u: string, domain: string = LOGIN_DOMAIN): string {
  return `${normalizeUsername(u)}@${domain}`;
}

export function emailToUsername(email: string, domain: string = LOGIN_DOMAIN): string | null {
  const suffix = '@' + domain;
  return email && email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length).toLowerCase() : null;
}

const LETTERS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/** 12 characters, letters and digits, without 0/O/1/l/I. */
export function generatePassword(): string {
  const all = LETTERS + DIGITS;
  for (;;) {
    const bytes = new Uint32Array(12);
    crypto.getRandomValues(bytes);
    const p = Array.from(bytes, (b) => all[b % all.length]).join('');
    if (validatePassword(p) === null) return p;
  }
}
