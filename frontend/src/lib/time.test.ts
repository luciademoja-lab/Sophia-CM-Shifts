import { describe, it, expect } from 'vitest';
import {
  zonedParts, zonedToUtc, tzOffsetMinutes, weekStart, addDays, dayStartMs, isoWeek,
  hm, minLabel, dur, dayLabel, rangeLabel, tzLabel, isValidTimeZone, sameDate, dateValue, parseDateValue, wallSpan,
} from './time';

const utc = (s: string) => Date.parse(s);

describe('zonedParts', () => {
  it('reads wall-clock parts in a time zone', () => {
    expect(zonedParts(utc('2026-10-23T07:50:00Z'), 'Europe/Rome')).toEqual({ y: 2026, m: 10, d: 23, hour: 9, minute: 50, weekday: 5 });
  });
  it('uses 1 = Monday ... 7 = Sunday', () => {
    expect(zonedParts(utc('2026-10-25T12:00:00Z'), 'UTC').weekday).toBe(7);
    expect(zonedParts(utc('2026-10-26T12:00:00Z'), 'UTC').weekday).toBe(1);
  });
  it('reports midnight as hour 0', () => {
    expect(zonedParts(utc('2026-10-22T22:00:00Z'), 'Europe/Rome').hour).toBe(0);
  });
});

describe('tzOffsetMinutes', () => {
  it('knows summer and winter time', () => {
    expect(tzOffsetMinutes(utc('2026-07-01T12:00:00Z'), 'Europe/Rome')).toBe(120);
    expect(tzOffsetMinutes(utc('2026-12-01T12:00:00Z'), 'Europe/Rome')).toBe(60);
    expect(tzOffsetMinutes(utc('2026-12-01T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
    expect(tzOffsetMinutes(utc('2026-12-01T12:00:00Z'), 'America/New_York')).toBe(-300);
  });
});

describe('zonedToUtc', () => {
  it('converts a wall-clock time to an instant', () => {
    expect(zonedToUtc({ y: 2026, m: 10, d: 23 }, 9 * 60 + 50, 'Europe/Rome')).toBe(utc('2026-10-23T07:50:00Z'));
  });
  it('handles the day DST ends (Rome, 25 Oct 2026)', () => {
    expect(zonedToUtc({ y: 2026, m: 10, d: 25 }, 0, 'Europe/Rome')).toBe(utc('2026-10-24T22:00:00Z'));
    expect(zonedToUtc({ y: 2026, m: 10, d: 25 }, 12 * 60, 'Europe/Rome')).toBe(utc('2026-10-25T11:00:00Z'));
  });
  it('handles the day DST starts (Rome, 29 Mar 2026)', () => {
    expect(zonedToUtc({ y: 2026, m: 3, d: 29 }, 12 * 60, 'Europe/Rome')).toBe(utc('2026-03-29T10:00:00Z'));
  });
  it('accepts 24:00 as the start of the next day', () => {
    expect(zonedToUtc({ y: 2026, m: 10, d: 23 }, 24 * 60, 'UTC')).toBe(utc('2026-10-24T00:00:00Z'));
  });
});

describe('plain dates', () => {
  it('finds the Monday of the week in the viewer time zone', () => {
    // Sunday 25 Oct 23:30 in New York is already Monday 26 Oct in Rome.
    const t = utc('2026-10-26T03:30:00Z');
    expect(weekStart(t, 'America/New_York')).toEqual({ y: 2026, m: 10, d: 19 });
    expect(weekStart(t, 'Europe/Rome')).toEqual({ y: 2026, m: 10, d: 26 });
  });
  it('adds days across month and year ends', () => {
    expect(addDays({ y: 2026, m: 12, d: 28 }, 7)).toEqual({ y: 2027, m: 1, d: 4 });
    expect(addDays({ y: 2026, m: 3, d: 1 }, -1)).toEqual({ y: 2026, m: 2, d: 28 });
  });
  it('gives the instant a day starts in a zone', () => {
    expect(dayStartMs({ y: 2026, m: 10, d: 23 }, 'Asia/Tokyo')).toBe(utc('2026-10-22T15:00:00Z'));
  });
  it('computes the ISO week number', () => {
    expect(isoWeek({ y: 2026, m: 10, d: 19 })).toBe(43);
    expect(isoWeek({ y: 2026, m: 1, d: 1 })).toBe(1);
    expect(isoWeek({ y: 2027, m: 1, d: 1 })).toBe(53);
  });
  it('compares and round-trips date input values', () => {
    expect(sameDate({ y: 2026, m: 1, d: 2 }, { y: 2026, m: 1, d: 2 })).toBe(true);
    expect(dateValue({ y: 2026, m: 1, d: 2 })).toBe('2026-01-02');
    expect(parseDateValue('2026-01-02')).toEqual({ y: 2026, m: 1, d: 2 });
    expect(parseDateValue('nope')).toBeNull();
  });
});

describe('labels', () => {
  it('formats times and durations like the original board', () => {
    expect(hm(utc('2026-10-23T07:05:00Z'), 'Europe/Rome')).toBe('09:05');
    expect(minLabel(1440)).toBe('24:00');
    expect(minLabel(75)).toBe('01:15');
    expect(dur(90)).toBe('1h 30m');
    expect(dur(120)).toBe('2h');
    expect(dur(45)).toBe('45m');
  });
  it('labels a day and a range, marking ranges that end the next day', () => {
    expect(dayLabel(utc('2026-10-23T07:00:00Z'), 'Europe/Rome')).toBe('Fri 23 Oct');
    expect(rangeLabel(utc('2026-10-23T07:00:00Z'), utc('2026-10-23T09:00:00Z'), 'Europe/Rome')).toBe('Fri 23 Oct 09:00–11:00');
    expect(rangeLabel(utc('2026-10-23T20:00:00Z'), utc('2026-10-23T23:00:00Z'), 'Europe/Rome')).toBe('Fri 23 Oct 22:00–01:00 (+1)');
    expect(rangeLabel(utc('2026-10-23T20:00:00Z'), utc('2026-10-23T22:00:00Z'), 'Europe/Rome')).toBe('Fri 23 Oct 22:00–00:00');
  });
  it('labels a time zone with its city and current UTC offset', () => {
    expect(tzLabel('Europe/Rome', utc('2026-10-23T07:00:00Z'))).toBe('Rome · UTC+2');
    expect(tzLabel('Asia/Kolkata', utc('2026-10-23T07:00:00Z'))).toBe('Kolkata · UTC+5:30');
    expect(tzLabel('America/Argentina/Buenos_Aires', utc('2026-10-23T07:00:00Z'))).toBe('Buenos Aires · UTC-3');
    expect(tzLabel('UTC', 0)).toBe('UTC');
  });
  it('validates time zone names', () => {
    expect(isValidTimeZone('Europe/Budapest')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('wallSpan (where a block sits in a day column)', () => {
  const sun = { y: 2026, m: 10, d: 25 }; // DST ends in Rome: the day has 25 hours
  const d0 = dayStartMs(sun, 'Europe/Rome'), dEnd = dayStartMs(addDays(sun, 1), 'Europe/Rome');
  it('uses the wall clock, so 10:00 is drawn at 10:00 even on the 25-hour day', () => {
    expect(wallSpan(utc('2026-10-25T09:00:00Z'), utc('2026-10-25T11:00:00Z'), d0, dEnd, 'Europe/Rome')).toEqual({ from: 600, to: 720 });
  });
  it('clips blocks that start the day before or end the day after', () => {
    expect(wallSpan(d0 - 3_600_000, utc('2026-10-24T23:00:00Z'), d0, dEnd, 'Europe/Rome')).toEqual({ from: 0, to: 60 });
    expect(wallSpan(utc('2026-10-25T21:00:00Z'), dEnd + 3_600_000, d0, dEnd, 'Europe/Rome')).toEqual({ from: 1320, to: 1440 });
  });
  it('is the same as elapsed time on a normal day', () => {
    const mon = { y: 2026, m: 10, d: 19 };
    expect(wallSpan(utc('2026-10-19T08:00:00Z'), utc('2026-10-19T10:30:00Z'), dayStartMs(mon, 'Europe/Rome'), dayStartMs(addDays(mon, 1), 'Europe/Rome'), 'Europe/Rome')).toEqual({ from: 600, to: 750 });
  });
});

import { clockChanges, dayHours } from './time';
describe('clock changes in the week (DST)', () => {
  const mon = { y: 2026, m: 10, d: 19 };
  it('knows which days are 23 or 25 hours long', () => {
    expect(dayHours({ y: 2026, m: 10, d: 25 }, 'Europe/Rome')).toBe(25);
    expect(dayHours({ y: 2026, m: 10, d: 25 }, 'America/Bogota')).toBe(24);
  });
  it('finds the day from which another zone moves against yours', () => {
    // Rome 07:00 is Bogota 00:00 until Saturday and 01:00 from Sunday: later for a Bogota viewer
    expect(clockChanges(mon, 'America/Bogota', 'Europe/Rome')).toEqual([{ day: 6, minutes: 60 }]);
    expect(clockChanges(mon, 'Europe/Rome', 'America/Bogota')).toEqual([{ day: 6, minutes: -60 }]);
    expect(clockChanges(mon, 'Europe/Rome', 'Europe/Budapest')).toEqual([]);
    expect(clockChanges({ y: 2026, m: 10, d: 26 }, 'Europe/Rome', 'America/New_York')).toEqual([{ day: 6, minutes: 60 }]);
  });
});
