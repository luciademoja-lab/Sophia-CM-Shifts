import { describe, it, expect } from 'vitest';
import { isTestLogin, shareRcms, teamColors, RCM_COLORS, bookingWindow, inBookingWindow, weeklyShare, requiredMinutesIn } from './team';
import type { Profile } from './shifts';

const p = (id: string, role: Profile['role'], fullName = id, active = true): Profile => ({ id, username: id, fullName, role, timezone: 'UTC', active });
const profiles = Object.fromEntries([
  p('rana', 'rcm'), p('kris', 'rcm'), p('regina', 'rcm'), p('olizhia', 'rcm'), p('test.rcm', 'rcm', 'Test Recruiter'),
  p('old', 'rcm', 'Old', false), p('lucia', 'admin'), p('max', 'viewer'),
].map((x) => [x.id, x]));

describe('team', () => {
  it('leaves test logins and inactive people out of the share', () => {
    expect(isTestLogin(profiles['test.rcm'])).toBe(true);
    expect(shareRcms(profiles).map((x) => x.id)).toEqual(['kris', 'olizhia', 'rana', 'regina']);
  });
  it('gives the four SCMs brown, green, purple and blue, and everyone a different colour', () => {
    const c = teamColors(profiles);
    expect(['kris', 'olizhia', 'rana', 'regina'].map((id) => c[id])).toEqual(RCM_COLORS);
    expect(new Set(Object.values(c)).size).toBe(Object.keys(c).length);
  });
  it('splits the required hours between the SCMs', () => {
    expect(weeklyShare(112 * 60, profiles)).toBe(28 * 60);
    expect(weeklyShare(100, {})).toBe(0);
  });
  it('adds up required minutes in a range', () => {
    expect(requiredMinutesIn([{ start: 0, end: 3_600_000 }, { start: 7_200_000, end: 9_000_000 }])).toBe(90);
  });
});

describe('booking window (this week and next, Monday–Sunday; on Sunday the week after opens)', () => {
  const at = (iso: string) => Date.parse(iso);
  it('runs from this Monday to the end of next week', () => {
    const w = bookingWindow(at('2026-10-23T12:00:00Z'), 'UTC'); // Friday
    expect(new Date(w.from).toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(new Date(w.to).toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
  it('opens one more week on Sunday, in the SCM time zone', () => {
    const w = bookingWindow(at('2026-10-25T10:00:00Z'), 'Europe/Rome'); // Sunday
    expect(new Date(w.to).toISOString()).toBe('2026-11-08T23:00:00.000Z');
    expect(inBookingWindow(at('2026-11-05T10:00:00Z'), at('2026-11-05T12:00:00Z'), at('2026-10-25T10:00:00Z'), 'Europe/Rome')).toBe(true);
    expect(inBookingWindow(at('2026-11-05T10:00:00Z'), at('2026-11-05T12:00:00Z'), at('2026-10-24T10:00:00Z'), 'Europe/Rome')).toBe(false);
  });
});
