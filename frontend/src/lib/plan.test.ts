import { describe, it, expect } from 'vitest';
import { suggestPlan, fairTargets } from './plan';
import type { Shift } from './shifts';

const H = 3_600_000, M = 60_000;
const t0 = Date.parse('2026-10-26T00:00:00Z'); // Monday
const at = (day: number, h: number) => t0 + day * 24 * H + h * H;
const iv = (day: number, a: number, b: number) => ({ start: at(day, a), end: at(day, b) });
const weekdays = (a: number, b: number) => [0, 1, 2, 3, 4].map((d) => iv(d, a, b));
const shift = (owner: string, day: number, a: number, b: number, status: Shift['status'] = 'booked'): Shift =>
  ({ id: `${owner}${day}${a}`, owner, start: at(day, a), end: at(day, b), status, coversId: null });
const mins = (s: { start: number; end: number }) => (s.end - s.start) / M;
const total = (plan: ReturnType<typeof suggestPlan>, who: string) => plan.suggestions.filter((s) => s.owner === who).reduce((m, s) => m + mins(s), 0);

describe('fairTargets (water-filling)', () => {
  it('splits the work evenly when everyone can do their share', () => {
    expect(fairTargets(480, [{ id: 'a', already: 0, capacity: 480 }, { id: 'b', already: 0, capacity: 480 }])).toEqual({ a: 240, b: 240 });
  });
  it('gives people with little availability all of it, and the rest to the others', () => {
    expect(fairTargets(2400, [{ id: 'a', already: 0, capacity: 240 }, { id: 'b', already: 0, capacity: 2400 }, { id: 'c', already: 0, capacity: 2400 }]))
      .toEqual({ a: 240, b: 1080, c: 1080 });
  });
  it('counts hours already booked towards each person\'s share', () => {
    expect(fairTargets(480, [{ id: 'a', already: 240, capacity: 480 }, { id: 'b', already: 0, capacity: 480 }])).toEqual({ a: 120, b: 360 });
  });
});

describe('suggestPlan', () => {
  it('reports required, covered and uncoverable hours', () => {
    const p = suggestPlan({ required: [iv(0, 8, 16)], shifts: [shift('a', 0, 8, 10)], people: [{ id: 'b', intervals: [iv(0, 10, 14)] }] });
    expect(p.requiredMinutes).toBe(480);
    expect(p.coveredMinutes).toBe(120);
    expect(p.noOneMinutes).toBe(120); // 14–16 nobody is available
    expect(p.suggestions).toEqual([{ owner: 'b', start: at(0, 10), end: at(0, 14) }]);
  });

  it('balances two people who are both always available, in long blocks', () => {
    const p = suggestPlan({ required: [iv(0, 8, 16)], shifts: [], people: [{ id: 'a', intervals: [iv(0, 0, 24)] }, { id: 'b', intervals: [iv(0, 0, 24)] }] });
    expect(total(p, 'a')).toBe(240);
    expect(total(p, 'b')).toBe(240);
    expect(p.suggestions).toHaveLength(2);
  });

  it('gives an RCM who is free only one day all of that day (40 h week example)', () => {
    const p = suggestPlan({
      required: weekdays(9, 17), // 40 h
      shifts: [],
      people: [
        { id: 'oneday', intervals: [iv(2, 9, 17)] }, // only Wednesday
        { id: 'b', intervals: weekdays(0, 24) },
        { id: 'c', intervals: weekdays(0, 24) },
      ],
    });
    expect(total(p, 'oneday')).toBe(480);
    expect(total(p, 'b')).toBe(960);
    expect(total(p, 'c')).toBe(960);
    expect(p.perPerson.find((x) => x.id === 'oneday')).toMatchObject({ offeredMinutes: 480, targetMinutes: 480 });
  });

  it('takes existing shifts into account for fairness', () => {
    const p = suggestPlan({
      required: [iv(0, 8, 16), iv(1, 8, 16)],
      shifts: [shift('a', 0, 8, 16)],
      people: [{ id: 'a', intervals: [iv(0, 0, 24), iv(1, 0, 24)] }, { id: 'b', intervals: [iv(0, 0, 24), iv(1, 0, 24)] }],
    });
    expect(total(p, 'a')).toBe(0);
    expect(total(p, 'b')).toBe(480);
  });

  it('does not suggest blocks shorter than 30 minutes when a neighbour can take them', () => {
    const p = suggestPlan({
      required: [iv(0, 8, 12)],
      shifts: [],
      people: [{ id: 'a', intervals: [iv(0, 8, 10.25)] }, { id: 'b', intervals: [iv(0, 8, 12)] }],
      minMinutes: 30,
    });
    expect(p.suggestions.every((s) => mins(s) >= 30)).toBe(true);
    expect(total(p, 'a') + total(p, 'b')).toBe(240);
  });

  it('suggests someone for shifts that need cover, but not their owner', () => {
    const p = suggestPlan({
      required: [iv(0, 8, 10)],
      shifts: [shift('a', 0, 8, 10, 'open')],
      people: [{ id: 'a', intervals: [iv(0, 0, 24)] }, { id: 'b', intervals: [iv(0, 0, 24)] }],
    });
    expect(p.suggestions).toEqual([{ owner: 'b', start: at(0, 8), end: at(0, 10) }]);
  });

  it('treats requests waiting for approval as covered and suggests nothing when all is covered', () => {
    const p = suggestPlan({ required: [iv(0, 8, 10)], shifts: [shift('a', 0, 8, 10, 'pending')], people: [{ id: 'b', intervals: [iv(0, 0, 24)] }] });
    expect(p.coveredMinutes).toBe(120);
    expect(p.suggestions).toEqual([]);
  });
});
