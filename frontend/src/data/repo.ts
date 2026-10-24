// The data layer the UI talks to. Two implementations:
//   supabaseRepo -> the real backend (Postgres functions + RLS, Auth, Realtime)
//   memoryRepo   -> same rules in memory, for demo mode and end-to-end tests
import type { Coverage, CoverageDays, Slot } from '../lib/coverage';
import type { Availability } from '../lib/availability';
import type { LogEntry, Profile, Report, Role, Shift } from '../lib/shifts';
import type { ReportInput, WeeklyReport } from '../lib/work';
import type { ContractLine } from '../lib/contracts';
import type { ShiftSession } from '../lib/session';
import type { TodoTemplate } from '../lib/todos';
import type { CoverageVersion } from '../lib/history';
import type { Task, TaskEvent, TaskInput, TaskStatus, TaskTimeRow } from '../lib/tasks';

export type Snapshot = {
  me: Profile | null;
  profiles: Record<string, Profile>;
  shifts: Shift[];
  log: LogEntry[];
  coverage: Coverage | null;
  /** reports by shift id, for the shifts and history entries in the snapshot */
  reports: Record<string, Report>;
  /** for admins: when they last looked at notifications (ms, 0 = never) */
  notificationsSeenAt: number;
  /** every request waiting for an admin, any week */
  requests: Shift[];
  /** availability of every admin and SCM, by profile id */
  availability: Record<string, Availability>;
  /** tasks the signed-in person may see (none for viewers) */
  tasks: Task[];
  /** time linked to tasks in shift reports: everyone's for admins, own for SCMs */
  taskTime: TaskTimeRow[];
  /** admins only: what happened to tasks */
  taskLog: TaskEvent[];
  /** weekly reports: all for admins and viewers, own for SCMs */
  weeklyReports: WeeklyReport[];
  /** Start/End shift sessions: own for SCMs, all for admins and viewers (recent ones) */
  sessions: ShiftSession[];
  /** to-dos ticked in those sessions */
  sessionTodos: SessionTodo[];
  /** to-do templates: all for admins, the ones for them for SCMs */
  todoTemplates: TodoTemplate[];
};
export type SessionTodo = { sessionId: string; templateId: string; item: number };
/** For the dashboard chart: every version of the required coverage, and the minutes worked per shift in a range. */
export type HoursHistory = { versions: CoverageVersion[]; worked: Array<{ start: number; minutes: number }> };

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
  saveReport(shiftId: string, report: ReportInput): Promise<void>;
  /** SCMs, from the Sunday of that week; week = Monday "YYYY-MM-DD" in their time zone */
  submitWeekly(week: string, message: string): Promise<string>;
  approveWeekly(id: string): Promise<void>;
  rejectWeekly(id: string): Promise<void>;
  createTask(task: TaskInput, people: string[]): Promise<string>;
  updateTask(id: string, task: TaskInput, people: string[]): Promise<void>;
  deleteTask(id: string): Promise<void>;
  /** person defaults to the signed-in user */
  moveTask(id: string, person: string | null, status: TaskStatus): Promise<void>;
  claimTask(id: string): Promise<void>;
  /** admins: share out the morning's contracts evenly, one task per SCM in `people` */
  createContractTasks(task: TaskInput, minutesEach: number, people: string[], items: ContractLine[]): Promise<string[]>;
  toggleTaskItem(id: string, done: boolean): Promise<void>;
  /** SCMs: clock in during their own booked shift */
  startShift(shiftId: string): Promise<string>;
  /** "Yes, I'm still working" */
  confirmShift(sessionId: string): Promise<void>;
  endShift(sessionId: string): Promise<void>;
  toggleSessionTodo(sessionId: string, templateId: string, item: number, done: boolean): Promise<void>;
  /** admins; id '' creates a new template */
  saveTodoTemplate(t: TodoTemplate): Promise<string>;
  deleteTodoTemplate(id: string): Promise<void>;
  /** admins and viewers: required vs worked hours over [from, to) */
  loadHoursHistory(from: number, to: number): Promise<HoursHistory>;
  approveShift(id: string): Promise<void>;
  rejectShift(id: string): Promise<void>;
  deleteLog(id: string): Promise<void>;
  markNotificationsSeen(): Promise<void>;
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
  /** the raw database message, kept for diagnosing problems */
  detail?: string;
  constructor(readonly code: ErrorCode, message: string, readonly overlap?: { who: string; start: number; end: number }) {
    super(message);
  }
}

/** What to show when the schedule cannot be loaded: the database's own reason helps fix it. */
export function loadErrorText(e: unknown): string {
  const raw = e instanceof RepoError ? e.detail || e.message : e instanceof Error ? e.message : String(e);
  if (/column .* does not exist|relation .* does not exist|function .* does not exist|schema cache/i.test(raw)) {
    return `The database is missing the latest update (${raw}). Run "npx.cmd supabase --workdir backend db push --linked", then reload the page.`;
  }
  return `Could not load the schedule (${raw}). Check your connection and reload the page.`;
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
    if (/shifts_one_rcm_per_slot/.test(message)) return new RepoError('overlap', 'Only one SCM per slot.');
    const e = new RepoError('network', 'Could not save. Check your connection and try again.');
    e.detail = message;
    return e;
  }
  const code = CODES[m[1]] || 'invalid';
  // the database still says "RCM" in a few messages: the role is now called SCM
  const detail = (m[2] || '').trim().replace(/\bRCM(s?)\b/g, 'SCM$1');
  if (code === 'overlap') {
    const o = /^overlaps (.+)'s shift (\S+)\/(\S+)$/.exec(detail);
    if (o) return new RepoError('overlap', detail, { who: o[1], start: Date.parse(o[2]), end: Date.parse(o[3]) });
  }
  return new RepoError(code, detail ? detail.charAt(0).toUpperCase() + detail.slice(1) + (/[.!?]$/.test(detail) ? '' : '.') : 'Not allowed.');
}
