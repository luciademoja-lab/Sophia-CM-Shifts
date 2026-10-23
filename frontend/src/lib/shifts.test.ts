import { describe, it, expect } from 'vitest';
import {
  activeShifts, findOverlap, weekHours, canManage, canReport, latestEntryPerShift, canAskCover, canChange, historyFor, notificationsFor, personColor, historyText, toCsv, onDutyAt, openInRange,
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
      { owner: 'kri', booked: 6 * H, covering: 5 * H, open: 0, pending: 0, worked: 0, reported: 0 },
      { owner: 'reg', booked: 2 * H, covering: 0, open: 2 * H, pending: 0, worked: 0, reported: 0 },
    ]);
  });
  it('adds the hours actually worked from reports, counted in the week the shift starts', () => {
    const list = [sh('a', 'reg', 8, 10), sh('b', 'reg', 30, 33), sh('d', 'reg', -3, 1)];
    const reports: Record<string, Report> = {
      a: { shiftId: 'a', owner: 'reg', workedMinutes: 150, notes: '', workTypes: [], posters: '', tasks: [], updatedAt: 0, updatedBy: 'reg' },
      d: { shiftId: 'd', owner: 'reg', workedMinutes: 240, notes: '', workTypes: [], posters: '', tasks: [], updatedAt: 0, updatedBy: 'reg' },
    };
    expect(weekHours(list, t0, t0 + 7 * 24 * H, reports)).toEqual([
      { owner: 'reg', booked: 6 * H, covering: 0, open: 0, pending: 0, worked: 150 * 60000, reported: 1 },
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

describe('requests, past days and cover', () => {
  const now = t0 + 2 * 24 * H + 12 * H; // Wednesday 12:00 UTC
  it('counts requests separately from booked hours', () => {
    expect(weekHours([sh('a', 'reg', 50, 52, { status: 'pending' })], t0, t0 + 7 * 24 * H)[0]).toMatchObject({ booked: 0, pending: 2 * H });
  });
  it('reserves the slot while a request waits', () => {
    expect(findOverlap([sh('a', 'reg', 8, 10, { status: 'pending' })], t0 + 9 * H, t0 + 11 * H, [])?.id).toBe('a');
  });
  it('allows reports only on approved shifts', () => {
    expect(canReport(sh('a', 'reg', 8, 10, { status: 'pending' }), profiles.reg, now)).toBe(false);
  });
  it('offers "ask for cover" only before a shift starts', () => {
    expect(canAskCover(sh('a', 'reg', 61, 62), profiles.reg, now)).toBe(true);
    expect(canAskCover(sh('a', 'reg', 59, 62), profiles.reg, now)).toBe(false);
    expect(canAskCover(sh('a', 'reg', 70, 72, { coversId: 'z' }), profiles.reg, now)).toBe(false);
  });
  it('locks shifts of past days for RCMs, in their own time zone, but not for admins', () => {
    const tuesday = sh('a', 'reg', 30, 32);
    expect(canChange(tuesday, profiles.reg, now)).toBe(false);
    expect(canChange(tuesday, profiles.luc, now)).toBe(true);
    expect(canChange(sh('a', 'reg', 49, 50), profiles.reg, now)).toBe(true); // Wednesday, today
    // 23:30 UTC on Tuesday is already Wednesday in Budapest
    expect(canChange(sh('a', 'reg', 47.5, 48), profiles.reg, now)).toBe(true);
  });
});

describe('history and notifications', () => {
  const e = (id: string, actor: string, owner: string, action: LogEntry['action'] = 'booked', at = t0, fromOwner: string | null = null): LogEntry =>
    ({ id, at, actor, owner, action, start: t0, end: t0 + H, fromOwner, shiftId: id });
  const log = [e('1', 'reg', 'reg'), e('2', 'kri', 'kri'), e('3', 'luc', 'reg'), e('4', 'kri', 'kri', 'took', t0, 'reg')];
  it('shows RCMs only what involves them', () => {
    expect(historyFor(log, profiles.reg, null).map((l) => l.id)).toEqual(['1', '3', '4']);
  });
  it('shows admins everything, or one person', () => {
    expect(historyFor(log, profiles.luc, null)).toHaveLength(4);
    expect(historyFor(log, profiles.luc, 'kri').map((l) => l.id)).toEqual(['2', '4']);
  });
  it('turns RCM changes into notifications for admins, newest first, with unread ones flagged', () => {
    const list = [e('1', 'reg', 'reg', 'booked', t0 + 1), e('2', 'luc', 'reg', 'edited', t0 + 2), e('3', 'kri', 'kri', 'requested', t0 + 3)];
    expect(notificationsFor(list, profiles, profiles.luc, t0 + 1)).toEqual([
      { entry: list[2], unread: true }, { entry: list[0], unread: false },
    ]);
    expect(notificationsFor(list, profiles, profiles.reg, 0)).toEqual([]);
  });
  it('describes requests and decisions', () => {
    const name = (id: string | null) => (id && profiles[id] ? profiles[id].fullName : 'Someone');
    expect(historyText(e('5', 'reg', 'reg', 'requested'), name, 'UTC')).toBe('Regina Nemeth requested a shift, Mon 19 Oct 00:00–01:00');
    expect(historyText(e('6', 'luc', 'reg', 'approved'), name, 'UTC')).toBe('Lucia De Mojà approved Regina Nemeth\'s request, Mon 19 Oct 00:00–01:00');
    expect(historyText(e('7', 'luc', 'reg', 'rejected'), name, 'UTC')).toBe('Lucia De Mojà rejected Regina Nemeth\'s request, Mon 19 Oct 00:00–01:00');
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
    const reports = { a: { shiftId: 'a', owner: 'reg', workedMinutes: 150, notes: 'Onboarded "3" posters', workTypes: [], posters: '', tasks: [], updatedAt: 0, updatedBy: 'reg' } };
    const csv = toCsv([sh('a', 'reg', 8, 10), sh('b', 'kri', 30, 31, { status: 'open' })], profiles, t0, t0 + 7 * 24 * H, 'Europe/Rome', reports);
    expect(csv.split('\r\n')).toEqual([
      '"Person","Their time zone","Start (Europe/Rome)","End (Europe/Rome)","Start (UTC)","End (UTC)","Hours booked","Status","Hours worked (reported)","Report"',
      '"Regina Nemeth","Europe/Budapest","2026-10-19 10:00","2026-10-19 12:00","2026-10-19T08:00:00.000Z","2026-10-19T10:00:00.000Z","2.00","Available","2.50","Onboarded ""3"" posters"',
      '"Kris Arévalo","America/Bogota","2026-10-20 08:00","2026-10-20 09:00","2026-10-20T06:00:00.000Z","2026-10-20T07:00:00.000Z","1.00","Needs cover","",""',
    ]);
  });
});
