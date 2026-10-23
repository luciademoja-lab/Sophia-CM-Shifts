import { describe, it, expect } from 'vitest';
import { availabilityIntervals, isAvailable, availableMinutes, daySlots, type Availability } from './availability';

const utc = (s: string) => Date.parse(s);
const H = 3_600_000;
// Week of Mon 19 Oct 2026; DST ends in Europe on Sun 25 Oct.
const from = utc('2026-10-18T00:00:00Z'), to = utc('2026-10-27T00:00:00Z');

const regina: Availability = {
  tz: 'Europe/Budapest',
  week: { 1: [{ start: 8 * 60, end: 12 * 60 }], 3: [{ start: 18 * 60, end: 24 * 60 }], 4: [{ start: 0, end: 2 * 60 }], 7: [{ start: 9 * 60, end: 11 * 60 }] },
  days: {},
};

describe('availabilityIntervals (usual week, in the RCM time zone)', () => {
  it('turns the usual week into instants, in her own time zone', () => {
    const iv = availabilityIntervals(regina, utc('2026-10-19T00:00:00Z'), utc('2026-10-20T00:00:00Z'));
    expect(iv).toEqual([{ start: utc('2026-10-19T06:00:00Z'), end: utc('2026-10-19T10:00:00Z') }]); // 08–12 Budapest (UTC+2)
  });
  it('joins slots that run across midnight', () => {
    const iv = availabilityIntervals(regina, utc('2026-10-21T00:00:00Z'), utc('2026-10-23T00:00:00Z'));
    expect(iv).toEqual([{ start: utc('2026-10-21T16:00:00Z'), end: utc('2026-10-22T00:00:00Z') }]); // Wed 18:00 → Thu 02:00
  });
  it('follows daylight saving time', () => {
    const iv = availabilityIntervals(regina, utc('2026-10-25T00:00:00Z'), utc('2026-10-26T00:00:00Z'));
    expect(iv).toEqual([{ start: utc('2026-10-25T08:00:00Z'), end: utc('2026-10-25T10:00:00Z') }]); // Sunday, now UTC+1
  });
  it('clips to the requested range', () => {
    const iv = availabilityIntervals(regina, utc('2026-10-19T08:00:00Z'), utc('2026-10-19T09:00:00Z'));
    expect(iv).toEqual([{ start: utc('2026-10-19T08:00:00Z'), end: utc('2026-10-19T09:00:00Z') }]);
  });
  it('is empty without a time zone', () => {
    expect(availabilityIntervals({ ...regina, tz: null }, from, to)).toEqual([]);
  });
});

describe('exceptions for a specific day', () => {
  it('replace the usual hours of that day', () => {
    const a: Availability = { ...regina, days: { '2026-10-19': [{ start: 14 * 60, end: 16 * 60 }] } };
    expect(availabilityIntervals(a, utc('2026-10-19T00:00:00Z'), utc('2026-10-20T00:00:00Z')))
      .toEqual([{ start: utc('2026-10-19T12:00:00Z'), end: utc('2026-10-19T14:00:00Z') }]);
  });
  it('can make a usual day unavailable', () => {
    const a: Availability = { ...regina, days: { '2026-10-19': [] } };
    expect(availabilityIntervals(a, utc('2026-10-19T00:00:00Z'), utc('2026-10-20T00:00:00Z'))).toEqual([]);
  });
  it('can add a day that is usually free', () => {
    const a: Availability = { ...regina, days: { '2026-10-20': [{ start: 10 * 60, end: 11 * 60 }] } };
    expect(availabilityIntervals(a, utc('2026-10-20T00:00:00Z'), utc('2026-10-21T00:00:00Z')))
      .toEqual([{ start: utc('2026-10-20T08:00:00Z'), end: utc('2026-10-20T09:00:00Z') }]);
  });
  it('tells which slots apply to a date and whether they are an exception', () => {
    const a: Availability = { ...regina, days: { '2026-10-19': [] } };
    expect(daySlots(a, { y: 2026, m: 10, d: 19 })).toEqual({ slots: [], exception: true });
    expect(daySlots(a, { y: 2026, m: 10, d: 21 })).toEqual({ slots: [{ start: 1080, end: 1440 }], exception: false });
  });
});

describe('isAvailable', () => {
  it('needs the whole shift inside availability', () => {
    expect(isAvailable(regina, utc('2026-10-19T06:00:00Z'), utc('2026-10-19T10:00:00Z'))).toBe(true);
    expect(isAvailable(regina, utc('2026-10-19T09:00:00Z'), utc('2026-10-19T11:00:00Z'))).toBe(false);
  });
  it('accepts a shift across midnight when both days are available', () => {
    expect(isAvailable(regina, utc('2026-10-21T20:00:00Z'), utc('2026-10-21T23:00:00Z'))).toBe(true);
  });
});

describe('availableMinutes', () => {
  it('sums the hours offered in a range', () => {
    // Mon 4h + Wed/Thu 8h + Sun 2h, in the week starting Mon 19 Oct
    expect(availableMinutes(regina, utc('2026-10-19T00:00:00Z'), utc('2026-10-26T00:00:00Z'))).toBe((4 + 8 + 2) * 60);
    expect(availableMinutes(regina, from, to)).toBe((4 + 4 + 8 + 2 + 2) * 60);
    expect(availableMinutes(regina, from, from + H)).toBe(0);
  });
});
