// Time-zone aware date helpers. Every function takes an explicit IANA time zone,
// so the board can be drawn in the viewer's chosen zone instead of the browser's.

export type PlainDate = { y: number; m: number; d: number };
export type ZonedParts = PlainDate & { hour: number; minute: number; weekday: number };

export const MINUTE = 60_000;
export const QUARTER = 15 * MINUTE;
export const HOUR = 60 * MINUTE;
export const DAY_MS = 24 * HOUR;
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const pad = (n: number) => String(n).padStart(2, '0');
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function zonedParts(ms: number, tz: string): ZonedParts {
  const p: Record<string, string> = {};
  for (const x of formatter(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour % 24, minute: +p.minute, weekday: WEEKDAY[p.weekday] };
}

/** Offset of the zone from UTC at that instant, in minutes (Rome in summer = 120). */
export function tzOffsetMinutes(ms: number, tz: string): number {
  const floored = Math.floor(ms / MINUTE) * MINUTE;
  const p = zonedParts(floored, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute) - floored) / MINUTE);
}

/** The instant at which the wall clock in `tz` shows `date` + `minutes` (0..1440). */
export function zonedToUtc(date: PlainDate, minutes: number, tz: string): number {
  const guess = Date.UTC(date.y, date.m - 1, date.d, 0, minutes);
  const first = guess - tzOffsetMinutes(guess, tz) * MINUTE;
  const second = guess - tzOffsetMinutes(first, tz) * MINUTE;
  return second;
}

export function addDays(date: PlainDate, n: number): PlainDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function sameDate(a: PlainDate, b: PlainDate): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

export function dateOf(ms: number, tz: string): PlainDate {
  const { y, m, d } = zonedParts(ms, tz);
  return { y, m, d };
}

/** Monday of the week that contains `ms`, as seen in `tz`. */
export function weekStart(ms: number, tz: string): PlainDate {
  const p = zonedParts(ms, tz);
  return addDays({ y: p.y, m: p.m, d: p.d }, -(p.weekday - 1));
}

export function dayStartMs(date: PlainDate, tz: string): number {
  return zonedToUtc(date, 0, tz);
}

export function isoWeek(date: PlainDate): number {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - y0) / DAY_MS + 1) / 7);
}

export function dateValue(date: PlainDate): string {
  return `${date.y}-${pad(date.m)}-${pad(date.d)}`;
}

export function parseDateValue(v: string): PlainDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

export function hm(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes since local midnight shown in `tz`. */
export function minuteOfDay(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return p.hour * 60 + p.minute;
}

export function minLabel(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function dur(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

export function shortDate(date: PlainDate): string {
  return `${date.d} ${MONTHS[date.m - 1]}`;
}

export function dayLabel(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${DAYS[p.weekday - 1]} ${p.d} ${MONTHS[p.m - 1]}`;
}

export function rangeLabel(start: number, end: number, tz: string): string {
  const sameDay = sameDate(dateOf(start, tz), dateOf(end - 1, tz));
  return `${dayLabel(start, tz)} ${hm(start, tz)}–${hm(end, tz)}${sameDay ? '' : ' (+1)'}`;
}

export function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '-', a = Math.abs(minutes);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
}

/** "Rome · UTC+2": the city part of the zone name plus its offset at `at`. */
export function tzLabel(tz: string, at: number): string {
  const city = tz.split('/').pop()!.replace(/_/g, ' ');
  const off = offsetLabel(tzOffsetMinutes(at, tz));
  return city === 'UTC' ? off : `${city} · ${off}`;
}

export function allTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try { return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : ['UTC']; } catch { return ['UTC']; }
}
