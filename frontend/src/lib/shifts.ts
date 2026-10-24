// Shifts: the availability SCMs book on the board, plus the rules the board enforces.
import { HOUR, dateOf, dateValue, hm, rangeLabel } from './time';
import type { TaskTime, WorkType } from './work';

export type ShiftStatus = 'booked' | 'open' | 'covered' | 'pending';
export type Shift = {
  id: string;
  owner: string;
  start: number;
  end: number;
  /** booked; open = needs cover; covered = someone else took it over; pending = request waiting for an admin */
  status: ShiftStatus;
  /** set on the shift created when someone takes over an open shift */
  coversId: string | null;
};
/** admin = Lucia, Aram; rcm = SCMs, Success Community Managers (the key stays "rcm" in the database); viewer = read-only (Max, Adrien) */
export type Role = 'admin' | 'rcm' | 'viewer';
export type Profile = {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  /** chosen by the SCM at first login; null until then */
  timezone: string | null;
  active: boolean;
};
export type LogAction = 'booked' | 'edited' | 'deleted' | 'restored' | 'ask' | 'cancelask' | 'took' | 'gaveback' | 'reported' | 'requested' | 'approved' | 'rejected';
export type LogEntry = {
  id: string;
  at: number;
  actor: string;
  owner: string;
  action: LogAction;
  start: number;
  end: number;
  fromOwner: string | null;
  /** the shift this entry is about (a deleted shift keeps its id here) */
  shiftId: string | null;
};
/** What the SCM did in a shift and the hours actually worked (may differ from the booking). */
export type Report = {
  shiftId: string;
  owner: string;
  workedMinutes: number;
  notes: string;
  /** kinds of work from the Vik 2.0 guide */
  workTypes: WorkType[];
  /** names of the posters who had issues (required with poster_issues) */
  posters: string;
  /** time spent on tasks during this shift */
  tasks: TaskTime[];
  updatedAt: number;
  updatedBy: string | null;
};

export function activeShifts(list: Shift[]): Shift[] {
  return list.filter((s) => s.status !== 'covered');
}

export function findOverlap(list: Shift[], start: number, end: number, ignore: string[]): Shift | undefined {
  return activeShifts(list).find((s) => !ignore.includes(s.id) && s.start < end && start < s.end);
}

export function onDutyAt(list: Shift[], now: number): Shift | undefined {
  return activeShifts(list).find((s) => s.status === 'booked' && s.start <= now && s.end > now);
}

export function openInRange(list: Shift[], from: number, to: number): Shift[] {
  return activeShifts(list).filter((s) => s.status === 'open' && s.end > from && s.start < to);
}

/** Milliseconds per person in [from, to); `worked` sums the reports of shifts starting in the range. */
export type Hours = { owner: string; booked: number; covering: number; open: number; pending: number; worked: number; reported: number };
export function weekHours(list: Shift[], from: number, to: number, reports: Record<string, Report> = {}): Hours[] {
  const per = new Map<string, Hours>();
  const get = (owner: string) => per.get(owner) || { owner, booked: 0, covering: 0, open: 0, pending: 0, worked: 0, reported: 0 };
  for (const s of activeShifts(list)) {
    const a = Math.max(s.start, from), b = Math.min(s.end, to);
    if (b <= a) continue;
    const h = get(s.owner);
    if (s.status === 'open') h.open += b - a;
    else if (s.status === 'pending') h.pending += b - a;
    else { h.booked += b - a; if (s.coversId) h.covering += b - a; }
    const r = reports[s.id];
    if (r && s.start >= from && s.start < to) { h.worked += r.workedMinutes * 60_000; h.reported += 1; }
    per.set(s.owner, h);
  }
  return [...per.values()].sort((x, y) => y.booked - x.booked || x.owner.localeCompare(y.owner));
}

export function canWrite(me: Profile | null): boolean {
  return !!me && me.active && me.role !== 'viewer';
}

export function canManage(s: Shift, me: Profile | null): boolean {
  return canWrite(me) && (me!.role === 'admin' || s.owner === me!.id);
}

/** Reports are written by the shift owner or an admin, once the shift has started. */
export function canReport(s: Shift, me: Profile | null, now: number): boolean {
  return canManage(s, me) && (s.status === 'booked' || s.status === 'open') && s.start <= now;
}

/** "Ask for cover" only on your own booked shift that has not started yet. */
export function canAskCover(s: Shift, me: Profile | null, now: number): boolean {
  return canManage(s, me) && s.status === 'booked' && !s.coversId && s.start > now;
}

/** SCMs cannot change or delete a shift of a past day (in their own time zone); admins can. */
export function canChange(s: Shift, me: Profile | null, now: number): boolean {
  if (!canManage(s, me)) return false;
  if (me!.role === 'admin') return true;
  const tz = me!.timezone || 'UTC';
  return dateValue(dateOf(s.start, tz)) >= dateValue(dateOf(now, tz));
}

const involves = (l: LogEntry, id: string) => l.actor === id || l.owner === id || l.fromOwner === id;

/** SCMs see what involves them; admins and viewers see everything, or one person. */
export function historyFor(log: LogEntry[], me: Profile | null, person: string | null): LogEntry[] {
  if (!me) return [];
  if (me.role === 'rcm') return log.filter((l) => involves(l, me.id));
  return person ? log.filter((l) => involves(l, person)) : log;
}

/** For admins: changes made by SCMs, newest first; unread = after they last looked. */
export function notificationsFor(log: LogEntry[], profiles: Record<string, Profile>, me: Profile | null, seenAt: number): Array<{ entry: LogEntry; unread: boolean }> {
  if (!me || me.role !== 'admin') return [];
  return log.filter((l) => profiles[l.actor]?.role === 'rcm').sort((a, b) => b.at - a.at).map((entry) => ({ entry, unread: entry.at > seenAt }));
}

/** Ids of the newest history entry for each shift: that is where its report is shown. */
export function latestEntryPerShift(log: LogEntry[]): Set<string> {
  const best = new Map<string, LogEntry>();
  for (const l of log) {
    if (!l.shiftId) continue;
    const b = best.get(l.shiftId);
    if (!b || l.at >= b.at) best.set(l.shiftId, l);
  }
  return new Set([...best.values()].map((l) => l.id));
}

export function hashHue(str: string): number {
  let h = 0;
  for (const c of str) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return h % 360;
}

export function personColor(username: string): string {
  return `hsl(${hashHue(username.toLowerCase())} 58% 50%)`;
}

const VERBS: Record<LogAction, string> = {
  booked: 'booked', edited: 'changed', deleted: 'deleted', restored: 'restored',
  ask: 'asked for cover on', cancelask: 'withdrew the cover request on', took: 'took over', gaveback: 'gave back', reported: 'reported on',
  requested: 'requested', approved: 'approved', rejected: 'rejected',
};

export function historyText(l: LogEntry, name: (id: string | null) => string, tz: string): string {
  const actor = name(l.actor);
  let txt: string;
  if (l.action === 'approved' || l.action === 'rejected') {
    txt = `${actor} ${l.action} ${name(l.owner)}'s request`;
  } else if (l.action === 'reported' && l.owner !== l.actor) {
    txt = `${actor} edited the report on ${name(l.owner)}'s shift`;
  } else if (l.action === 'took') {
    txt = l.owner === l.actor ? `${actor} took over ${name(l.fromOwner)}'s shift` : `${actor} gave ${name(l.fromOwner)}'s shift to ${name(l.owner)}`;
  } else {
    const whose = l.owner && l.owner !== l.actor ? `${name(l.owner)}'s shift` : 'a shift';
    txt = `${actor} ${VERBS[l.action] || l.action} ${whose}`;
  }
  if (l.start && l.end) txt += `, ${rangeLabel(l.start, l.end, tz)}`;
  return txt;
}

export function toCsv(list: Shift[], profiles: Record<string, Profile>, from: number, to: number, tz: string, reports: Record<string, Report> = {}): string {
  const q = (v: string) => '"' + v.replace(/"/g, '""') + '"';
  const local = (ms: number) => `${dateValue(dateOf(ms, tz))} ${hm(ms, tz)}`;
  const name = (id: string) => profiles[id]?.fullName || 'Someone';
  const rows = [['Person', 'Their time zone', `Start (${tz})`, `End (${tz})`, 'Start (UTC)', 'End (UTC)', 'Hours booked', 'Status', 'Hours worked (reported)', 'Report']];
  const inWeek = activeShifts(list).filter((s) => s.end > from && s.start < to).sort((a, b) => a.start - b.start);
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const s of inWeek) {
    const covered = s.coversId ? byId.get(s.coversId) : undefined;
    const status = s.status === 'open' ? 'Needs cover' : s.coversId ? `Covering for ${covered ? name(covered.owner) : 'someone'}` : 'Available';
    rows.push([name(s.owner), profiles[s.owner]?.timezone || '', local(s.start), local(s.end),
      new Date(s.start).toISOString(), new Date(s.end).toISOString(), ((s.end - s.start) / HOUR).toFixed(2), status,
      reports[s.id] ? (reports[s.id].workedMinutes / 60).toFixed(2) : '', reports[s.id]?.notes || '']);
  }
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}
