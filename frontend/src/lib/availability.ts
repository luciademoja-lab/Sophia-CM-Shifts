// SCM availability: a usual week (slots per weekday, in the SCM's own time zone)
// plus exceptions for specific dates that replace that day's usual slots.
import type { CoverageDays, Slot, Weekday } from './coverage';
import { addDays, dateOf, dateValue, zonedParts, zonedToUtc, type PlainDate } from './time';
import type { Interval } from './coverage';

export type Availability = {
  /** the SCM's own time zone; without it nothing can be placed on the board */
  tz: string | null;
  /** usual week: weekday 1 = Monday ... 7 = Sunday */
  week: CoverageDays;
  /** exceptions by local date "YYYY-MM-DD": these slots replace the usual ones ([] = not available) */
  days: Record<string, Slot[]>;
};

export const emptyAvailability = (tz: string | null): Availability => ({ tz, week: {}, days: {} });

function weekdayOf(date: PlainDate): Weekday {
  const d = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
  return (d === 0 ? 7 : d) as Weekday;
}

/** The slots that apply to a local date, and whether they come from an exception. */
export function daySlots(a: Availability, date: PlainDate): { slots: Slot[]; exception: boolean } {
  const key = dateValue(date);
  if (Object.prototype.hasOwnProperty.call(a.days, key)) return { slots: a.days[key], exception: true };
  return { slots: a.week[weekdayOf(date)] || [], exception: false };
}

/** Available time within [from, to), merged and sorted, as UTC instants. */
export function availabilityIntervals(a: Availability, from: number, to: number): Interval[] {
  if (!a.tz || to <= from) return [];
  const tz = a.tz;
  const raw: Interval[] = [];
  const first = addDays(dateOf(from, tz), -1), last = addDays(dateOf(to, tz), 1);
  for (let d = first; dateValue(d) <= dateValue(last); d = addDays(d, 1)) {
    for (const s of daySlots(a, d).slots) {
      const start = Math.max(zonedToUtc(d, s.start, tz), from);
      const end = Math.min(zonedToUtc(d, s.end, tz), to);
      if (end > start) raw.push({ start, end });
    }
  }
  raw.sort((x, y) => x.start - y.start);
  const out: Interval[] = [];
  for (const iv of raw) {
    const prev = out[out.length - 1];
    if (prev && iv.start <= prev.end) prev.end = Math.max(prev.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

export function isAvailable(a: Availability, start: number, end: number): boolean {
  return availabilityIntervals(a, start, end).some((iv) => iv.start <= start && iv.end >= end);
}

export function availableMinutes(a: Availability, from: number, to: number): number {
  return availabilityIntervals(a, from, to).reduce((m, iv) => m + (iv.end - iv.start) / 60_000, 0);
}

/** Weekday (1–7) of an instant in a zone; handy for editors. */
export function weekdayAt(ms: number, tz: string): Weekday {
  return zonedParts(ms, tz).weekday as Weekday;
}
