// The data layer the UI talks to. Two implementations:
//   supabaseRepo -> the real backend (Postgres functions + RLS, Auth, Realtime)
//   memoryRepo   -> same rules in memory, for demo mode and end-to-end tests
import type { Coverage, CoverageDays, Slot } from '../lib/coverage';
import type { Availability } from '../lib/availability';
import type { LogEntry, Profile, Report, Role, Shift } from '../lib/shifts';

export type Snapshot = {
  me: Profile | null;
  profiles: Record<string, Profile>;
  shifts: Shift[];
  log: LogEntry[];
  coverage: Coverage | null;
  /** reports by shift id, for the shifts and history entries in the snapshot */
  reports: Record<string, Report>;
  /** availability of every admin and RCM, by profile id */
  availability: Record<string, Availability>;
};

export type NewLogin = { username: string; fullName: string; password: string; role: Role };

export interface Repo {
  readonly mode: 'live' | 'demo';
  /** Signed-in user id, or null. */
  session(): Promise<string | null>;
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: () => void): () => void;
  /** Everything the board needs for [from, to). */
  load(from: number, to: number): Promise<Snapshot>;
  /** Calls back whenever someone changes the data. */
  subscribe(onChange: () => void): () => void;

  setMyTimezone(tz: string): Promise<void>;
  bookShift(start: number, end: number, owner?: string | null, restore?: boolean): Promise<string>;
  updateShift(id: string, start: number, end: number, owner?: string | null): Promise<void>;
  deleteShift(id: string): Promise<void>;
  askCover(id: string): Promise<void>;
  cancelAsk(id: string): Promise<void>;
  takeShift(id: string, forId?: string | null): Promise<string>;
  setCoverage(tz: string, days: CoverageDays): Promise<void>;
  saveReport(shiftId: string, workedMinutes: number, notes: string): Promise<void>;
  /** usual week; owner defaults to the signed-in user (admins can pass someone else) */
  setAvailability(week: CoverageDays, owner?: string | null): Promise<void>;
  /** exception for a local date "YYYY-MM-DD"; null removes it, [] means not available */
  setAvailabilityDay(day: string, slots: Slot[] | null, owner?: string | null): Promise<void>;
  deleteReport(shiftId: string): Promise<void>;

  createLogin(l: NewLogin): Promise<{ id: string; username: string }>;
  resetPassword(userId: string, password: string): Promise<void>;
  updateProfile(id: string, fullName: string, role: Role, active: boolean): Promise<void>;
}

export type ErrorCode = 'overlap' | 'forbidden' | 'invalid' | 'not_found' | 'not_signed_in' | 'bad_login' | 'conflict' | 'network';

export class RepoError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly overlap?: { who: string; start: number; end: number }) {
    super(message);
  }
}

const CODES: Record<string, ErrorCode> = {
  RCM_OVERLAP: 'overlap', RCM_FORBIDDEN: 'forbidden', RCM_INVALID: 'invalid',
  RCM_NOT_FOUND: 'not_found', RCM_NOT_SIGNED_IN: 'not_signed_in',
};

/** Turns a Supabase Auth sign-in error into something the person can act on. */
export function signInError(message: string): RepoError {
  const m = (message || '').trim();
  if (/invalid login credentials/i.test(m)) return new RepoError('bad_login', 'Wrong username or password.');
  if (/email not confirmed/i.test(m)) return new RepoError('bad_login', 'This login is not confirmed yet. In Supabase, confirm the user (or recreate it with "Auto Confirm User").');
  if (/api key/i.test(m)) return new RepoError('network', `Sign-in failed: ${m}. Check VITE_SUPABASE_ANON_KEY in Vercel.`);
  if (/fetch|network/i.test(m)) return new RepoError('network', `Sign-in failed: ${m}. Check VITE_SUPABASE_URL in Vercel and your connection.`);
  return new RepoError('network', `Sign-in failed: ${m}`);
}

/** Turns a Postgres error message from our functions into a RepoError. */
export function parseDbError(message: string): RepoError {
  const m = /(RCM_[A-Z_]+)(?::\s*(.*))?/.exec(message || '');
  if (!m) {
    if (/shifts_one_rcm_per_slot/.test(message)) return new RepoError('overlap', 'Only one RCM per slot.');
    return new RepoError('network', 'Could not save. Check your connection and try again.');
  }
  const code = CODES[m[1]] || 'invalid';
  const detail = (m[2] || '').trim();
  if (code === 'overlap') {
    const o = /^overlaps (.+)'s shift (\S+)\/(\S+)$/.exec(detail);
    if (o) return new RepoError('overlap', detail, { who: o[1], start: Date.parse(o[2]), end: Date.parse(o[3]) });
  }
  return new RepoError(code, detail ? detail.charAt(0).toUpperCase() + detail.slice(1) + (/[.!?]$/.test(detail) ? '' : '.') : 'Not allowed.');
}
