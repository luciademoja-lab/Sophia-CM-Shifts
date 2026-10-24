// What SCMs report: the kinds of work from the Vik 2.0 guide, time on tasks,
// and the weekly report they send to the admins on Sunday.
import type { Report, Shift } from './shifts';
import { addDays, dateValue, dayStartMs, dur, isoWeek, parseDateValue, rangeLabel, shortDate, weekStart } from './time';

export const WORK_TYPES = ['onboarding', 'accounts_check', 'poster_issues', 'community'] as const;
export type WorkType = (typeof WORK_TYPES)[number];
const LABELS: Record<WorkType, string> = {
  onboarding: 'Onboarding',
  accounts_check: 'Daily accounts check',
  poster_issues: "Posters' issues",
  community: 'Community management',
};
export const workTypeLabel = (t: WorkType): string => LABELS[t] ?? t;

export type TaskTime = { taskId: string; minutes: number };
export type WeeklyStatus = 'submitted' | 'approved' | 'rejected';
export type WeeklyReport = {
  id: string; owner: string;
  /** Monday "YYYY-MM-DD" in the SCM's time zone */
  week: string;
  workedMinutes: number; message: string; status: WeeklyStatus;
  submittedAt: number; decidedBy: string | null; decidedAt: number | null;
};
export type ReportInput = { workedMinutes: number; notes: string; workTypes: WorkType[]; posters: string; tasks: TaskTime[] };

export function validateReport(r: ReportInput): string | null {
  if (!(r.workedMinutes >= 0 && r.workedMinutes <= 1440)) return 'Worked hours must be between 0 and 24.';
  if (r.workTypes.some((t) => !WORK_TYPES.includes(t))) return 'Pick a kind of work from the list.';
  if (!r.workTypes.length && !r.tasks.length) return 'Tick at least one kind of work, or link a task.';
  if (r.workTypes.includes('poster_issues') && !r.posters.trim()) return "Write the names of the posters who had issues.";
  if (r.posters.length > 1000) return 'The list of posters is too long.';
  if (r.notes.length > 4000) return 'The report is too long.';
  const ids = new Set<string>();
  let total = 0;
  for (const t of r.tasks) {
    if (ids.has(t.taskId)) return 'The same task is linked twice.';
    ids.add(t.taskId);
    if (!(Number.isInteger(t.minutes) && t.minutes > 0)) return 'Give each linked task some minutes.';
    total += t.minutes;
  }
  if (total > r.workedMinutes) return 'The time on tasks is more than the hours worked.';
  return null;
}

/** Monday ("YYYY-MM-DD") of the week a moment falls in, in the SCM's time zone. */
export const reportWeek = (ms: number, tz: string): string => dateValue(weekStart(ms, tz));

/** Weekly reports open on the Sunday of that week, at midnight in the SCM's time zone. */
export function weeklyOpensAt(week: string, tz: string): number {
  return dayStartMs(addDays(parseDateValue(week)!, 6), tz);
}
export const canSubmitWeekly = (week: string, tz: string, now: number): boolean => now >= weeklyOpensAt(week, tz);

const inWeek = (s: Shift, owner: string, week: string, tz: string) => s.owner === owner && s.status !== 'covered' && s.status !== 'pending' && reportWeek(s.start, tz) === week;

/** Hours the SCM reported for the week (not the booked ones). */
export function weeklyMinutes(owner: string, week: string, tz: string, shifts: Shift[], reports: Record<string, Report>): number {
  return shifts.filter((s) => inWeek(s, owner, week, tz) && reports[s.id]).reduce((m, s) => m + reports[s.id].workedMinutes, 0);
}

export type WeeklyInput = {
  owner: string; name: string; week: string; tz: string;
  shifts: Shift[]; reports: Record<string, Report>; taskTitles: Record<string, string>;
};

/** The message the SCM checks and sends; built from their shift reports. */
export function weeklyMessage(w: WeeklyInput): string {
  const mon = parseDateValue(w.week)!;
  const mine = w.shifts.filter((s) => inWeek(s, w.owner, w.week, w.tz)).sort((a, b) => a.start - b.start);
  const done = mine.filter((s) => w.reports[s.id]);
  const missing = mine.filter((s) => !w.reports[s.id] && s.start < dayStartMs(addDays(mon, 7), w.tz));
  const total = done.reduce((m, s) => m + w.reports[s.id].workedMinutes, 0);
  const posters = new Set<string>();
  const lines = done.map((s) => {
    const r = w.reports[s.id];
    const kinds = r.workTypes.map((t) => (t === 'poster_issues' && r.posters.trim() ? `${workTypeLabel(t)} (${r.posters.trim()})` : workTypeLabel(t)));
    if (r.workTypes.includes('poster_issues')) r.posters.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => posters.add(x));
    const tasks = r.tasks.map((t) => `Task: ${w.taskTitles[t.taskId] || 'task'} ${dur(t.minutes)}`);
    return '- ' + [rangeLabel(s.start, s.end, w.tz), dur(r.workedMinutes), ...(kinds.length ? [kinds.join(', ')] : []), ...tasks, ...(r.notes ? [r.notes] : [])].join(' · ');
  });
  const out = [
    `Weekly report · ${w.name} · week ${isoWeek(mon)} (${shortDate(mon)} – ${shortDate(addDays(mon, 6))})`,
    `Hours worked: ${dur(total)} (${done.length} shift${done.length === 1 ? '' : 's'} reported)`,
    '',
    ...lines,
  ];
  if (posters.size) out.push('', `Posters with issues: ${[...posters].join(', ')}`);
  if (missing.length) out.push('', `Not reported yet: ${missing.map((s) => rangeLabel(s.start, s.end, w.tz)).join('; ')}`);
  return out.join('\n');
}
