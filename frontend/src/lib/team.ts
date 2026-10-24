// The SCM team: who shares the required hours, their colours on the calendar,
// and the weeks SCMs may book.
import type { Interval } from './coverage';
import type { Profile } from './shifts';
import { addDays, dayStartMs, weekStart, zonedParts } from './time';

/** brown, green, purple, blue: one per SCM, very different from each other */
export const RCM_COLORS = ['#8B5A2B', '#1E9E4A', '#7E3FD1', '#1F6FEB'];
const OTHER_COLORS = ['#D9467A', '#0E9AA7', '#E07B00', '#6B7280', '#B8860B', '#C0392B', '#2C3E50', '#16A085'];

export const isTestLogin = (p: Profile): boolean => /test/i.test(`${p.username} ${p.fullName}`);

/** Active SCMs who share the required hours (test logins left out), in a stable order. */
export function shareRcms(profiles: Record<string, Profile>): Profile[] {
  return Object.values(profiles).filter((p) => p.active && p.role === 'rcm' && !isTestLogin(p)).sort((a, b) => a.username.localeCompare(b.username));
}

/** A clearly different colour for every person: the SCMs first, then everyone else. */
export function teamColors(profiles: Record<string, Profile>): Record<string, string> {
  const out: Record<string, string> = {};
  shareRcms(profiles).forEach((p, i) => { out[p.id] = RCM_COLORS[i] ?? OTHER_COLORS[(i - RCM_COLORS.length) % OTHER_COLORS.length]; });
  const rest = Object.values(profiles).filter((p) => !out[p.id]).sort((a, b) => a.username.localeCompare(b.username));
  const extra = Math.max(0, shareRcms(profiles).length - RCM_COLORS.length);
  rest.forEach((p, i) => { out[p.id] = OTHER_COLORS[(i + extra) % OTHER_COLORS.length]; });
  return out;
}

export const requiredMinutesIn = (required: Interval[]): number => required.reduce((m, r) => m + (r.end - r.start) / 60_000, 0);

/** Each SCM's share of the week's required hours. */
export function weeklyShare(requiredMinutes: number, profiles: Record<string, Profile>): number {
  const n = shareRcms(profiles).length;
  return n ? Math.round(requiredMinutes / n) : 0;
}

/** SCMs book from this Monday to the end of next week; on Sunday the week after opens too. */
export function bookingWindow(now: number, tz: string): { from: number; to: number } {
  const mon = weekStart(now, tz);
  const sunday = zonedParts(now, tz).weekday === 7;
  return { from: dayStartMs(mon, tz), to: dayStartMs(addDays(mon, sunday ? 21 : 14), tz) };
}
export function inBookingWindow(start: number, end: number, now: number, tz: string): boolean {
  const w = bookingWindow(now, tz);
  return start >= w.from && end <= w.to;
}
