// Required coverage: for each weekday, a list of time slots that must always have
// one SCM on duty. Several slots per day leave gaps between them (Aram, Oct 2026).
import { DAYS_LONG, QUARTER, minLabel, zonedParts, zonedToUtc, type PlainDate } from './time';

export type Slot = { start: number; end: number }; // minutes from local midnight, end exclusive
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type CoverageDays = Partial<Record<Weekday, Slot[]>>;
export type Coverage = { tz: string; days: CoverageDays };

const DAY_MIN = 24 * 60;

export function normalizeCoverage(raw: unknown): Coverage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { tz?: string; days?: Record<string, unknown> };
  const days: CoverageDays = {};
  for (const [k, v] of Object.entries(r.days || {})) {
    const list = Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [];
    const slots = (list as Slot[])
      .filter((s) => s && typeof s.start === 'number' && typeof s.end === 'number')
      .map((s) => ({ start: s.start, end: s.end }))
      .sort((a, b) => a.start - b.start);
    if (slots.length) days[+k as Weekday] = slots;
  }
  return { tz: r.tz || 'UTC', days };
}

export function validateDaySlots(slots: Slot[]): string | null {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  for (const s of sorted) {
    if (s.start < 0 || s.end > DAY_MIN) return 'times must be between 00:00 and 24:00';
    if (s.start % 15 || s.end % 15) return 'times must be on the quarter hour';
    if (s.end <= s.start) return 'the end must be after the start';
  }
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (b.start < a.end) return `slots ${minLabel(a.start)}–${minLabel(a.end)} and ${minLabel(b.start)}–${minLabel(b.end)} overlap`;
  }
  return null;
}

export function validateCoverage(days: CoverageDays): string | null {
  for (const [k, slots] of Object.entries(days)) {
    const d = +k;
    if (!(d >= 1 && d <= 7)) return `unknown weekday ${k}`;
    const e = validateDaySlots(slots || []);
    if (e) return `${DAYS_LONG[d - 1]}: ${e}`;
  }
  return null;
}

export function hasTarget(c: Coverage | null): boolean {
  return !!c && Object.values(c.days).some((s) => s && s.length);
}

export function isRequired(ms: number, c: Coverage | null): boolean {
  if (!c) return false;
  const p = zonedParts(ms, c.tz);
  const min = p.hour * 60 + p.minute;
  return (c.days[p.weekday as Weekday] || []).some((s) => min >= s.start && min < s.end);
}

/** Whole range inside the required hours (with no target set, every hour counts). */
export function isRequiredRange(c: Coverage | null, start: number, end: number): boolean {
  if (!hasTarget(c)) return true;
  for (let t = start; t < end; t += QUARTER) if (!isRequired(Math.min(t + QUARTER / 2, (t + end) / 2), c)) return false;
  return true;
}

export type Interval = { start: number; end: number };
export type Run = { from: number; to: number }; // 15-minute slot indexes in the viewer's day, `to` exclusive

/** Required-but-uncovered runs of a day column, drawn in the viewer's zone. */
export function uncoveredRuns(day: PlainDate, viewerTz: string, c: Coverage | null, booked: Interval[]): Run[] {
  const runs: Run[] = [];
  if (!hasTarget(c)) return runs;
  let from = -1;
  for (let s = 0; s <= 96; s++) {
    let unc = false;
    if (s < 96) {
      const t = zonedToUtc(day, s * 15, viewerTz);
      unc = isRequired(t + QUARTER / 2, c) && !booked.some((x) => x.start <= t && x.end >= t + QUARTER);
    }
    if (unc && from < 0) from = s;
    if (!unc && from >= 0) { runs.push({ from, to: s }); from = -1; }
  }
  return runs;
}

export function coverageText(slots: Slot[] | undefined): string {
  return slots && slots.length ? slots.map((s) => `${minLabel(s.start)}–${minLabel(s.end)}`).join(', ') : 'Not required';
}

/** What the "+ slot" button adds to a day: a new slot after the last one, leaving a gap. */
export function suggestNextSlot(slots: Slot[]): (Slot & { shrinkLastTo?: number }) | null {
  if (!slots.length) return { start: 7 * 60, end: DAY_MIN };
  const last = [...slots].sort((a, b) => a.start - b.start)[slots.length - 1];
  if (last.end + 60 + 15 <= DAY_MIN) {
    const start = last.end + 60;
    return { start, end: Math.min(DAY_MIN, start + 240) };
  }
  if (last.start > DAY_MIN - 180) return null;
  const start = Math.max(last.start + 120, 20 * 60);
  return { start, end: DAY_MIN, shrinkLastTo: start - 60 };
}
