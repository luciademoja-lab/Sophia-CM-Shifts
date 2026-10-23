import { describe, it, expect } from 'vitest';
import {
  activeShifts, findOverlap, weekHours, canManage, canReport, latestEntryPerShift, personColor, historyText, toCsv, onDutyAt, openInRange,
  type Shift, type Profile, type LogEntry, type Report,
} from './shifts';

const utc = (s: string) => Date.parse(s);
const H = 3_600_000;
const t0 = utc('2026-10-19T00:00:00Z'); // Monday

const sh = (id: string, owner: string, startH: number, endH: number, extra: Partial<Shift> = {}): Shift =>
  ({ id, owner, start: t0 + startH * H, end: t0 + endH * H, status: 'booked', coversId: null, ...extra });

const profiles: Record<string, Profile> = {
  reg: { id: 'reg', username: 'regina', fullName: 'Regina Nemeth', role: 'rcm', timezone: 'Europe/Budapest', active: true },
  kri: { id: 'kri', username: 'kris', fullName: 'Kris Arévalo', role: 'rcm', timezone: 'America/Bogota', active: true },
  luc: { id: 'luc', username: 'lucia', fullName: 'Lucia De Mojà', role: 'admin', timezone: 'Europe/Rome', active: true },
};

describe('activeShifts', () => {
  it('hides shifts that someone else has taken over', () => {
    const list = [sh('a', 'reg', 8, 10, { status: 'covered' }), sh('b', 'kri', 8, 10, { coversId: 'a' }), sh('c', 'reg', 12, 14)];
    expect(activeShifts(list).map((s) => s.id)).toEqual(['b', 'c']);
  });
});

describe('findOverlap (one RCM per slot)', () => {
  const list = [sh('a', 'reg', 8, 10), sh('b', 'kri', 12, 14, { status: 'open' })];
  it('finds a clash with a booked or open shift', () => {
    expect(findOverlap(list, t0 + 9 * H, t0 + 11 * H, [])?.id).toBe('a');
    expect(findOverlap(list, t0 + 13 * H, t0 + 15 * H, [])?.id).toBe('b');
  });
  it('allows back-to-back shifts', () => {
    expect(findOverlap(list, t0 + 10 * H, t0 + 12 * H, [])).toBeUndefined();
  });
  it('ignores the shift being edited', () => {
    expect(findOverlap(list, t0 + 8 * H, t0 + 11 * H, ['a'])).toBeUndefined();
  });
  it('ignores covered shifts', () => {
    expect(findOverlap([sh('a', 'reg', 8, 10, { status: 'covered' })], t0 + 8 * H, t0 + 9 * H, [])).toBeUndefined();
  });
});

describe('weekHours', () => {
  it('sums availability, cover and open time per person within the week, busiest first', () => {
    const list = [
      sh('a', 'reg', 8, 10),
      sh('b', 'kri', 10, 15, { coversId: 'z' }),
      sh('c', 'reg', 20, 22, { status: 'open' }),
      sh('d', 'kri', -3, 1), // starts the Sunday before: only 1h counts
    ];
    expect(weekHours(list, t0, t0 + 7 * 24 * H)).toEqual([
      { owner: 'kri', booked: 6 * H, covering: 5 * H, open: 0, worked: 0, reported: 0 },
      { owner: 'reg', booked: 2 * H, covering: 0, open: 2 * H, worked: 0, reported: 0 },
    ]);
  });
  it('adds the hours actually worked from reports, counted in the week the shift starts', () => {
    const list = [sh('a', 'reg', 8, 10), sh('b', 'reg', 30, 33), sh('d', 'reg', -3, 1)];
    const reports: Record<string, Report> = {
      a: { shiftId: 'a', owner: 'reg', workedMinutes: 150, notes: '', updatedAt: 0, updatedBy: 'reg' },
      d: { shiftId: 'd', owner: 'reg', workedMinutes: 240, notes: '', updatedAt: 0, updatedBy: 'reg' },
    };
    expect(weekHours(list, t0, t0 + 7 * 24 * H, reports)).toEqual([
      { owner: 'reg', booked: 6 * H, covering: 0, open: 0, worked: 150 * 60000, reported: 1 },
    ]);
  });
});

describe('who is on duty and what needs cover', () => {
  const list = [sh('a', 'reg', 8, 10), sh('b', 'kri', 12, 14, { status: 'open' })];
  it('finds the booked shift that contains now', () => {
    expect(onDutyAt(list, t0 + 9 * H)?.owner).toBe('reg');
    expect(onDutyAt(list, t0 + 13 * H)).toBeUndefined();
  });
  it('lists open shifts in a range', () => {
    expect(openInRange(list, t0, t0 + 24 * H).map((s) => s.id)).toEqual(['b']);
  });
});

describe('canManage', () => {
  it('lets owners and admins change a shift', () => {
    expect(canManage(sh('a', 'reg', 1, 2), profiles.reg)).toBe(true);
    expect(canManage(sh('a', 'reg', 1, 2), profiles.luc)).toBe(true);
    expect(canManage(sh('a', 'reg', 1, 2), profiles.kri)).toBe(false);
    expect(canManage(sh('a', 'reg', 1, 2), null)).toBe(false);
    expect(canManage(sh('a', 'max', 1, 2), { ...profiles.reg, id: 'max', role: 'viewer' })).toBe(false);
  });
});

describe('canReport', () => {
  const now = t0 + 12 * H;
  it('lets the owner or an admin report once the shift has started', () => {
    expect(canReport(sh('a', 'reg', 8, 10), profiles.reg, now)).toBe(true);
    expect(canReport(sh('a', 'reg', 11, 14), profiles.reg, now)).toBe(true);
    expect(canReport(sh('a', 'reg', 8, 10), profiles.luc, now)).toBe(true);
  });
  it('not before it starts, not for others, not on a shift taken over', () => {
    expect(canReport(sh('a', 'reg', 13, 14), profiles.reg, now)).toBe(false);
    expect(canReport(sh('a', 'reg', 8, 10), profiles.kri, now)).toBe(false);
    expect(canReport(sh('a', 'reg', 8, 10, { status: 'covered' }), profiles.reg, now)).toBe(false);
  });
});

describe('latestEntryPerShift', () => {
  it('picks the newest history entry of each shift, where its report is shown', () => {
    const e = (id: string, at: number, shiftId: string | null): LogEntry => ({ id, at, actor: 'reg', owner: 'reg', action: 'booked', start: 0, end: 0, fromOwner: null, shiftId });
    expect([...latestEntryPerShift([e('1', 1, 'a'), e('2', 2, 'a'), e('3', 3, 'b'), e('4', 4, null)])].sort()).toEqual(['2', '3']);
  });
});

describe('personColor', () => {
  it('is stable per username', () => {
    expect(personColor('regina')).toBe(personColor('regina'));
    expect(personColor('regina')).not.toBe(personColor('kris'));
    expect(personColor('regina')).toMatch(/^hsl\(\d+ 58% 50%\)$/);
  });
});

describe('historyText', () => {
  const name = (id: string | null) => (id && profiles[id] ? profiles[id].fullName : 'Someone');
  const base: LogEntry = { id: 'l', at: t0, actor: 'reg', owner: 'reg', action: 'booked', start: t0 + 8 * H, end: t0 + 10 * H, fromOwner: null, shiftId: 'a' };
  it('describes own changes', () => {
    expect(historyText(base, name, 'UTC')).toBe('Regina Nemeth booked a shift, Mon 19 Oct 08:00–10:00');
  });
  it('describes changes to someone else\'s shift', () => {
    expect(historyText({ ...base, actor: 'luc', action: 'deleted' }, name, 'UTC')).toBe('Lucia De Mojà deleted Regina Nemeth\'s shift, Mon 19 Oct 08:00–10:00');
  });
  it('describes take-overs, by the taker or by an admin', () => {
    expect(historyText({ ...base, actor: 'kri', owner: 'kri', action: 'took', fromOwner: 'reg' }, name, 'UTC')).toBe('Kris Arévalo took over Regina Nemeth\'s shift, Mon 19 Oct 08:00–10:00');
    expect(historyText({ ...base, actor: 'luc', owner: 'kri', action: 'took', fromOwner: 'reg' }, name, 'UTC')).toBe('Lucia De Mojà gave Regina Nemeth\'s shift to Kris Arévalo, Mon 19 Oct 08:00–10:00');
  });
  it('describes reports', () => {
    expect(historyText({ ...base, action: 'reported' }, name, 'UTC')).toBe('Regina Nemeth reported on a shift, Mon 19 Oct 08:00–10:00');
    expect(historyText({ ...base, actor: 'luc', action: 'reported' }, name, 'UTC')).toBe('Lucia De Mojà edited the report on Regina Nemeth\'s shift, Mon 19 Oct 08:00–10:00');
  });
  it('describes cover requests', () => {
    expect(historyText({ ...base, action: 'ask' }, name, 'UTC')).toBe('Regina Nemeth asked for cover on a shift, Mon 19 Oct 08:00–10:00');
  });
});

describe('toCsv', () => {
  it('exports the week with the viewer zone, UTC and each person\'s own zone', () => {
    const reports = { a: { shiftId: 'a', owner: 'reg', workedMinutes: 150, notes: 'Onboarded "3" posters', updatedAt: 0, updatedBy: 'reg' } };
    const csv = toCsv([sh('a', 'reg', 8, 10), sh('b', 'kri', 30, 31, { status: 'open' })], profiles, t0, t0 + 7 * 24 * H, 'Europe/Rome', reports);
    expect(csv.split('\r\n')).toEqual([
      '"Person","Their time zone","Start (Europe/Rome)","End (Europe/Rome)","Start (UTC)","End (UTC)","Hours booked","Status","Hours worked (reported)","Report"',
      '"Regina Nemeth","Europe/Budapest","2026-10-19 10:00","2026-10-19 12:00","2026-10-19T08:00:00.000Z","2026-10-19T10:00:00.000Z","2.00","Available","2.50","Onboarded ""3"" posters"',
      '"Kris Arévalo","America/Bogota","2026-10-20 08:00","2026-10-20 09:00","2026-10-20T06:00:00.000Z","2026-10-20T07:00:00.000Z","1.00","Needs cover","",""',
    ]);
  });
});
