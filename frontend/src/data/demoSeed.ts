// Demo data: the 2.0 team, a coverage target with a midday gap, and a few shifts this week.
import { addDays, weekStart, zonedToUtc } from '../lib/time';
import type { Seed } from './memoryRepo';

export const DEMO_PASSWORD = 'demo2026pass';

export function demoSeed(now: number): Seed {
  const tz = 'Europe/Rome';
  const mon = weekStart(now, tz);
  const at = (day: number, h: number) => zonedToUtc(addDays(mon, day), h * 60, tz);
  return {
    users: [
      { username: 'lucia', fullName: 'Lucia De Mojà', role: 'admin', password: DEMO_PASSWORD, timezone: 'Europe/Rome' },
      { username: 'aram', fullName: 'Aram Hamawandy', role: 'admin', password: DEMO_PASSWORD, timezone: 'Europe/Rome' },
      { username: 'regina', fullName: 'Regina Nemeth', role: 'rcm', password: DEMO_PASSWORD, timezone: 'Europe/Budapest' },
      { username: 'kris', fullName: 'Kris Arévalo', role: 'rcm', password: DEMO_PASSWORD, timezone: 'America/Bogota' },
      { username: 'rana', fullName: 'Rana Barakli', role: 'rcm', password: DEMO_PASSWORD, timezone: 'Europe/Istanbul' },
      { username: 'max', fullName: 'Max', role: 'viewer', password: DEMO_PASSWORD, timezone: 'Europe/Paris' },
      { username: 'adrien', fullName: 'Adrien', role: 'viewer', password: DEMO_PASSWORD, timezone: 'Europe/Paris' },
      { username: 'olizhia', fullName: 'Olizhia Mairuhu', role: 'rcm', password: DEMO_PASSWORD, timezone: null },
    ],
    coverage: {
      tz,
      days: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, [{ start: 7 * 60, end: 13 * 60 }, { start: 14 * 60, end: 24 * 60 }]])),
    },
    shifts: [
      { owner: 'regina', start: at(0, 7), end: at(0, 13) },
      { owner: 'rana', start: at(0, 14), end: at(0, 19) },
      { owner: 'kris', start: at(0, 19), end: at(1, 0) },
      { owner: 'regina', start: at(1, 7), end: at(1, 12) },
      { owner: 'kris', start: at(2, 15), end: at(2, 21), status: 'open' },
    ],
  };
}
