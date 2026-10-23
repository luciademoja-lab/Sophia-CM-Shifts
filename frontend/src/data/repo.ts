// The data layer the UI talks to. Two implementations:
//   supabaseRepo -> the real backend (Postgres functions + RLS, Auth, Realtime)
//   memoryRepo   -> same rules in memory, for demo mode and end-to-end tests
import type { Coverage, CoverageDays } from '../lib/coverage';
import type { LogEntry, Profile, Report, Role, Shift } from '../lib/shifts';

export type Snapshot = {
  me: Profile | null;
  profiles: Record<string, Profile>;
  shifts: Shift[];
  log: LogEntry[];
  coverage: Coverage | null;
  /** reports by shift id, for the shifts and history entries in the snapshot */
  reports: Record<string, Report>;
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
