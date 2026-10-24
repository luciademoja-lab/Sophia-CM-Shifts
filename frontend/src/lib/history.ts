// Required hours (the target we set) against the hours actually worked, week by week.
// Every change to the required coverage is kept as a version, so past weeks keep the
// target that was in force at the time.
import { availabilityIntervals } from './availability';
import type { CoverageDays } from './coverage';
import type { Report, Shift } from './shifts';
import { addDays, dateValue, dayStartMs, isoWeek, weekStart } from './time';

export type CoverageVersion = { validFrom: number; tz: string; days: CoverageDays };
export type HistoryWeek = { week: string; label: string; start: number; end: number };
export type HistoryPoint = { week: string; label: string; requiredHours: number; workedHours: number };

export const PERIODS = [
  { key: 'month', label: 'Month (4 weeks)', weeks: 4 },
  { key: '6months', label: '6 months', weeks: 26 },
  { key: '12months', label: '12 months', weeks: 52 },
] as const;
export type PeriodKey = (typeof PERIODS)[number]['key'];

/** The last n weeks (Monday–Sunday in tz), oldest first, ending with the current week. */
export function lastWeeks(now: number, tz: string, n: number): HistoryWeek[] {
  const mon = weekStart(now, tz);
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(mon, -7 * (n - 1 - i));
    return { week: dateValue(d), label: `W${isoWeek(d)}`, start: dayStartMs(d, tz), end: dayStartMs(addDays(d, 7), tz) };
  });
}

/** Required minutes in [start, end), each moment counted with the target in force then. */
export function requiredInWeek(versions: CoverageVersion[], start: number, end: number): number {
  const sorted = [...versions].sort((a, b) => a.validFrom - b.validFrom);
  let total = 0;
  sorted.forEach((v, i) => {
    const from = Math.max(start, v.validFrom), to = Math.min(end, sorted[i + 1]?.validFrom ?? Infinity);
    if (to <= from) return;
    for (const iv of availabilityIntervals({ tz: v.tz, week: v.days, days: {} }, from, to)) total += (iv.end - iv.start) / 60_000;
  });
  return Math.round(total);
}

/** Minutes worked per shift: the report if there is one, otherwise the clocked time. */
export function workedMinutesByShift(shifts: Shift[], reports: Record<string, Report>, clocked: Array<{ shiftId: string; minutes: number }>): Array<{ start: number; minutes: number }> {
  const out: Array<{ start: number; minutes: number }> = [];
  for (const s of shifts) {
    const m = reports[s.id]?.workedMinutes ?? clocked.filter((c) => c.shiftId === s.id).reduce((a, c) => a + c.minutes, 0);
    if (m > 0) out.push({ start: s.start, minutes: m });
  }
  return out;
}

const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

export function weeklyHistory(weeks: HistoryWeek[], versions: CoverageVersion[], worked: Array<{ start: number; minutes: number }>): HistoryPoint[] {
  return weeks.map((w) => ({
    week: w.week, label: w.label,
    requiredHours: hours(requiredInWeek(versions, w.start, w.end)),
    workedHours: hours(worked.filter((x) => x.start >= w.start && x.start < w.end).reduce((a, x) => a + x.minutes, 0)),
  }));
}
