import { describe, it, expect } from 'vitest';
import { lastWeeks, PERIODS, requiredInWeek, weeklyHistory, workedMinutesByShift, type CoverageVersion } from './history';
import type { Report, Shift } from './shifts';

const H = 3_600_000;
const tz = 'Europe/Rome';
const sixPerDay: CoverageVersion = { validFrom: Date.parse('2000-01-01T00:00:00Z'), tz, days: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, [{ start: 420, end: 780 }]])) };
const fourPerDay: CoverageVersion = { validFrom: Date.parse('2026-10-20T10:00:00Z'), tz, days: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, [{ start: 480, end: 720 }]])) };

describe('lastWeeks', () => {
  it('gives the last n weeks (Monday–Sunday) ending with the current one, with ISO week numbers', () => {
    const w = lastWeeks(Date.parse('2026-10-24T18:00:00Z'), tz, 4);
    expect(w.map((x) => x.label)).toEqual(['W40', 'W41', 'W42', 'W43']);
    expect(w[3].week).toBe('2026-10-19');
    expect(w[3].end - w[3].start).toBe(7 * 24 * H + H); // the week with the clock change has one hour more
  });
  it('offers a month (4 weeks), 6 months and 12 months', () => {
    expect(PERIODS.map((p) => [p.key, p.weeks])).toEqual([['month', 4], ['6months', 26], ['12months', 52]]);
  });
});

describe('requiredInWeek (the target in force that week)', () => {
  const [w] = lastWeeks(Date.parse('2026-10-14T12:00:00Z'), tz, 1); // week 42
  it('adds up the required hours of the week', () => {
    expect(requiredInWeek([sixPerDay], w.start, w.end)).toBe(42 * 60);
  });
  it('uses the target in force on each day, so later changes do not rewrite the past', () => {
    expect(requiredInWeek([sixPerDay, fourPerDay], w.start, w.end)).toBe(42 * 60);
    const [w43] = lastWeeks(Date.parse('2026-10-24T12:00:00Z'), tz, 1); // changed on Tue 20 Oct, 12:00 Rome
    expect(requiredInWeek([sixPerDay, fourPerDay], w43.start, w43.end)).toBe(6 * 60 + 5 * 60 + 5 * 4 * 60); // Mon 6h; Tue 07–12 under the old target; then 4h a day
  });
  it('is zero before any target was set', () => {
    expect(requiredInWeek([], w.start, w.end)).toBe(0);
  });
});

describe('workedMinutesByShift and weeklyHistory', () => {
  const shift = (id: string, iso: string, hours: number, owner = 'r'): Shift => ({ id, owner, start: Date.parse(iso), end: Date.parse(iso) + hours * H, status: 'booked', coversId: null });
  const report = (shiftId: string, workedMinutes: number): Report => ({ shiftId, owner: 'r', workedMinutes, notes: '', workTypes: [], posters: '', tasks: [], updatedAt: 0, updatedBy: 'r' });

  it('counts the reported hours, or the clocked hours when there is no report', () => {
    const shifts = [shift('a', '2026-10-19T06:00:00Z', 6), shift('b', '2026-10-20T06:00:00Z', 6), shift('c', '2026-10-21T06:00:00Z', 6)];
    const worked = workedMinutesByShift(shifts, { a: report('a', 300) }, [{ shiftId: 'b', minutes: 200 }]);
    expect(worked).toEqual([{ start: shifts[0].start, minutes: 300 }, { start: shifts[1].start, minutes: 200 }]);
  });

  it('puts required and worked hours side by side for every week', () => {
    const weeks = lastWeeks(Date.parse('2026-10-24T18:00:00Z'), tz, 2);
    const worked = [{ start: Date.parse('2026-10-19T06:00:00Z'), minutes: 300 }, { start: Date.parse('2026-10-13T06:00:00Z'), minutes: 120 }];
    expect(weeklyHistory(weeks, [sixPerDay], worked)).toEqual([
      { week: '2026-10-12', label: 'W42', requiredHours: 42, workedHours: 2 },
      { week: '2026-10-19', label: 'W43', requiredHours: 42, workedHours: 5 },
    ]);
  });
});
