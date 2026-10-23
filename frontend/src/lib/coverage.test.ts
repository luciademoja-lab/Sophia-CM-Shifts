import { describe, it, expect } from 'vitest';
import {
  normalizeCoverage, validateDaySlots, validateCoverage, isRequired, hasTarget,
  uncoveredRuns, coverageText, suggestNextSlot, type Coverage,
} from './coverage';

const utc = (s: string) => Date.parse(s);
const rome = (days: Coverage['days']): Coverage => ({ tz: 'Europe/Rome', days });

describe('normalizeCoverage', () => {
  it('turns the old one-range-per-day shape into lists of slots', () => {
    expect(normalizeCoverage({ tz: 'UTC', days: { 1: { start: 420, end: 1440 } } })).toEqual({ tz: 'UTC', days: { 1: [{ start: 420, end: 1440 }] } });
  });
  it('sorts slots and drops empty days', () => {
    expect(normalizeCoverage({ tz: 'UTC', days: { 2: [{ start: 900, end: 1200 }, { start: 420, end: 720 }], 3: [] } }))
      .toEqual({ tz: 'UTC', days: { 2: [{ start: 420, end: 720 }, { start: 900, end: 1200 }] } });
  });
  it('returns null for nothing', () => {
    expect(normalizeCoverage(null)).toBeNull();
  });
});

describe('validateDaySlots (gaps allowed)', () => {
  it('accepts several slots with gaps between them', () => {
    expect(validateDaySlots([{ start: 420, end: 720 }, { start: 840, end: 1440 }])).toBeNull();
  });
  it('accepts slots that touch', () => {
    expect(validateDaySlots([{ start: 420, end: 720 }, { start: 720, end: 900 }])).toBeNull();
  });
  it('rejects a slot that ends before it starts', () => {
    expect(validateDaySlots([{ start: 720, end: 720 }])).toBe('the end must be after the start');
  });
  it('rejects overlapping slots', () => {
    expect(validateDaySlots([{ start: 420, end: 810 }, { start: 720, end: 900 }])).toBe('slots 07:00–13:30 and 12:00–15:00 overlap');
  });
  it('rejects times outside the day or off the 15-minute grid', () => {
    expect(validateDaySlots([{ start: -15, end: 60 }])).toBe('times must be between 00:00 and 24:00');
    expect(validateDaySlots([{ start: 10, end: 60 }])).toBe('times must be on the quarter hour');
  });
});

describe('validateCoverage', () => {
  it('names the day that has a problem', () => {
    expect(validateCoverage({ 1: [{ start: 60, end: 120 }], 3: [{ start: 600, end: 510 }] })).toBe('Wednesday: the end must be after the start');
    expect(validateCoverage({ 1: [{ start: 60, end: 120 }] })).toBeNull();
  });
  it('rejects unknown weekdays', () => {
    expect(validateCoverage({ 8: [{ start: 60, end: 120 }] } as never)).toBe('unknown weekday 8');
  });
});

describe('isRequired', () => {
  const cov = rome({ 5: [{ start: 9 * 60, end: 12 * 60 }, { start: 14 * 60, end: 18 * 60 }] });
  it('is true inside any slot of the day, in the coverage time zone', () => {
    expect(isRequired(utc('2026-10-23T08:00:00Z'), cov)).toBe(true); // Fri 10:00 Rome
    expect(isRequired(utc('2026-10-23T13:00:00Z'), cov)).toBe(true); // Fri 15:00 Rome
  });
  it('is false in the gap between slots and on other days', () => {
    expect(isRequired(utc('2026-10-23T11:00:00Z'), cov)).toBe(false); // Fri 13:00 Rome, in the gap
    expect(isRequired(utc('2026-10-24T08:00:00Z'), cov)).toBe(false); // Saturday
  });
  it('treats the end of a slot as exclusive', () => {
    expect(isRequired(utc('2026-10-23T10:00:00Z'), cov)).toBe(false); // 12:00 Rome
  });
  it('is false when there is no target', () => {
    expect(isRequired(0, null)).toBe(false);
    expect(hasTarget(null)).toBe(false);
    expect(hasTarget(rome({}))).toBe(false);
    expect(hasTarget(cov)).toBe(true);
  });
});

describe('uncoveredRuns', () => {
  const day = { y: 2026, m: 10, d: 23 };
  const cov = rome({ 5: [{ start: 9 * 60, end: 12 * 60 }, { start: 14 * 60, end: 16 * 60 }] });
  it('returns every required run when nobody is booked', () => {
    expect(uncoveredRuns(day, 'Europe/Rome', cov, [])).toEqual([{ from: 36, to: 48 }, { from: 56, to: 64 }]);
  });
  it('leaves the gap between slots uncoloured', () => {
    const runs = uncoveredRuns(day, 'Europe/Rome', cov, []);
    expect(runs.some((r) => r.from < 56 && r.to > 48)).toBe(false);
  });
  it('removes booked time and keeps the remainder', () => {
    const booked = [{ start: utc('2026-10-23T07:00:00Z'), end: utc('2026-10-23T09:00:00Z') }]; // 09:00–11:00 Rome
    expect(uncoveredRuns(day, 'Europe/Rome', cov, booked)).toEqual([{ from: 44, to: 48 }, { from: 56, to: 64 }]);
  });
  it('maps the target into the viewer time zone', () => {
    // 09:00–12:00 Rome is 08:00–11:00 in London.
    expect(uncoveredRuns(day, 'Europe/London', rome({ 5: [{ start: 540, end: 720 }] }), [])).toEqual([{ from: 32, to: 44 }]);
  });
});

describe('coverageText', () => {
  it('lists every slot of a day', () => {
    expect(coverageText([{ start: 420, end: 720 }, { start: 840, end: 1440 }])).toBe('07:00–12:00, 14:00–24:00');
    expect(coverageText(undefined)).toBe('Not required');
  });
});

describe('suggestNextSlot (the + slot button)', () => {
  it('starts with the default day when there is none', () => {
    expect(suggestNextSlot([])).toEqual({ start: 420, end: 1440 });
  });
  it('proposes a slot one hour after the last one', () => {
    expect(suggestNextSlot([{ start: 420, end: 720 }])).toEqual({ start: 780, end: 1020 });
  });
  it('shrinks the last slot to make room when it runs to midnight', () => {
    expect(suggestNextSlot([{ start: 420, end: 1440 }])).toEqual({ start: 1200, end: 1440, shrinkLastTo: 1140 });
  });
  it('gives up when there is no room left', () => {
    expect(suggestNextSlot([{ start: 1380, end: 1440 }])).toBeNull();
  });
});
