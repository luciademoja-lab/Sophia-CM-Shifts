import { describe, it, expect } from 'vitest';
import { validateReport, workTypeLabel, WORK_TYPES, reportWeek, weeklyOpensAt, canSubmitWeekly, weeklyMessage, weeklyMinutes, type ReportInput } from './work';
import type { Report, Shift } from './shifts';

const base: ReportInput = { workedMinutes: 120, notes: '', workTypes: ['onboarding'], posters: '', tasks: [] };

describe('validateReport (the four kinds of work from the Vik 2.0 guide)', () => {
  it('only offers the four kinds of work', () => {
    expect(WORK_TYPES).toEqual(['onboarding', 'accounts_check', 'poster_issues', 'community']);
    expect(WORK_TYPES.map(workTypeLabel)).toEqual(['Onboarding', 'Daily accounts check', "Posters' issues", 'Community management']);
  });
  it('accepts a report with at least one kind of work', () => {
    expect(validateReport(base)).toBeNull();
  });
  it('refuses anything else as a kind of work', () => {
    expect(validateReport({ ...base, workTypes: ['payments' as never] })).toMatch(/kind of work/);
  });
  it('needs a kind of work or a linked task', () => {
    expect(validateReport({ ...base, workTypes: [] })).toMatch(/Tick at least one/);
    expect(validateReport({ ...base, workTypes: [], tasks: [{ taskId: 't1', minutes: 60 }] })).toBeNull();
  });
  it("needs the posters' names for posters' issues", () => {
    expect(validateReport({ ...base, workTypes: ['poster_issues'] })).toMatch(/names of the posters/);
    expect(validateReport({ ...base, workTypes: ['poster_issues'], posters: 'Ana, Bo' })).toBeNull();
  });
  it('keeps the time on tasks within the hours worked', () => {
    expect(validateReport({ ...base, tasks: [{ taskId: 't1', minutes: 90 }, { taskId: 't2', minutes: 60 }] })).toMatch(/more than the hours worked/);
    expect(validateReport({ ...base, tasks: [{ taskId: 't1', minutes: 0 }] })).toMatch(/minutes/);
    expect(validateReport({ ...base, tasks: [{ taskId: 't1', minutes: 30 }, { taskId: 't1', minutes: 30 }] })).toMatch(/twice/);
  });
  it('validates hours and length', () => {
    expect(validateReport({ ...base, workedMinutes: 1500 })).toMatch(/between 0 and 24/);
    expect(validateReport({ ...base, notes: 'x'.repeat(4001) })).toMatch(/too long/);
  });
});

// Week 44: Mon 26 Oct – Sun 1 Nov 2026
const shift = (id: string, startIso: string, hours: number, owner = 'r'): Shift =>
  ({ id, owner, start: Date.parse(startIso), end: Date.parse(startIso) + hours * 3_600_000, status: 'booked', coversId: null });
const report = (shiftId: string, workedMinutes: number, extra: Partial<Report> = {}): Report =>
  ({ shiftId, owner: 'r', workedMinutes, notes: '', workTypes: ['onboarding'], posters: '', tasks: [], updatedAt: 0, updatedBy: 'r', ...extra });

describe('weekly report timing', () => {
  it('puts a shift in the week of its start, in the SCM time zone', () => {
    expect(reportWeek(Date.parse('2026-10-26T05:00:00Z'), 'Europe/Budapest')).toBe('2026-10-26');
    expect(reportWeek(Date.parse('2026-10-26T03:00:00Z'), 'America/Bogota')).toBe('2026-10-19'); // still Sunday night there
  });
  it('opens on Sunday in the SCM time zone and stays open afterwards', () => {
    expect(weeklyOpensAt('2026-10-26', 'Europe/Budapest')).toBe(Date.parse('2026-10-31T23:00:00Z'));
    expect(canSubmitWeekly('2026-10-26', 'Europe/Budapest', Date.parse('2026-10-31T22:59:00Z'))).toBe(false);
    expect(canSubmitWeekly('2026-10-26', 'Europe/Budapest', Date.parse('2026-10-31T23:00:00Z'))).toBe(true);
    expect(canSubmitWeekly('2026-10-26', 'Europe/Budapest', Date.parse('2026-11-03T10:00:00Z'))).toBe(true);
  });
});

describe('weeklyMessage', () => {
  const tz = 'Europe/Budapest';
  const shifts = [
    shift('a', '2026-10-26T06:00:00Z', 6),
    shift('b', '2026-10-27T06:00:00Z', 5),
    shift('c', '2026-10-28T06:00:00Z', 4),
    shift('x', '2026-11-02T06:00:00Z', 4), // next week
    shift('o', '2026-10-27T13:00:00Z', 2, 'someone else'),
  ];
  const reports = {
    a: report('a', 330, { workTypes: ['onboarding', 'poster_issues'], posters: 'Ana, Bo', notes: 'Busy Monday' }),
    b: report('b', 300, { workTypes: ['community'], tasks: [{ taskId: 't1', minutes: 120 }] }),
    x: report('x', 240),
  };
  const tasks = { t1: 'Clean up Zone B channel' };

  it('counts reported hours, not booked ones', () => {
    expect(weeklyMinutes('r', '2026-10-26', tz, shifts, reports)).toBe(630);
  });

  it('writes a ready-to-send message with hours, days, kinds of work, posters and tasks', () => {
    const m = weeklyMessage({ owner: 'r', name: 'Regina Nemeth', week: '2026-10-26', tz, shifts, reports, taskTitles: tasks });
    expect(m).toContain('Weekly report · Regina Nemeth · week 44 (26 Oct – 1 Nov)');
    expect(m).toContain('Hours worked: 10h 30m (2 shifts reported)');
    expect(m).toContain('Mon 26 Oct 07:00–13:00 · 5h 30m · Onboarding, Posters\' issues (Ana, Bo) · Busy Monday');
    expect(m).toContain('Tue 27 Oct 07:00–12:00 · 5h · Community management · Task: Clean up Zone B channel 2h');
    expect(m).toContain('Not reported yet: Wed 28 Oct 07:00–11:00');
    expect(m).toContain("Posters with issues: Ana, Bo");
    expect(m).not.toContain('2 Nov');
  });
});
