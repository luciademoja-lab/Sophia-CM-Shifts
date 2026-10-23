import { describe, it, expect } from 'vitest';
import { unreadCount } from './Notifications';
import type { LogEntry, Profile, Shift } from '../lib/shifts';
import type { WeeklyReport } from '../lib/work';
import type { TaskEvent } from '../lib/tasks';

const prof = (id: string, role: Profile['role']): Profile => ({ id, username: id, fullName: id, role, timezone: 'UTC', active: true });
const profiles = { lucia: prof('lucia', 'admin'), regina: prof('regina', 'rcm') };
const entry = (at: number, action: LogEntry['action']): LogEntry => ({ id: String(at), at, actor: 'regina', owner: 'regina', action, start: 0, end: 1, fromOwner: null, shiftId: 's' + at });
const request: Shift = { id: 's10', owner: 'regina', start: 0, end: 1, status: 'pending', coversId: null };
const weekly = (submittedAt: number): WeeklyReport => ({ id: 'w', owner: 'regina', week: '2026-10-19', workedMinutes: 60, message: 'x', status: 'submitted', submittedAt, decidedBy: null, decidedAt: null });
const task = (at: number): TaskEvent => ({ id: 't' + at, at, actor: 'regina', taskId: 't', title: 'T', person: 'regina', action: 'moved', status: 'done' });

describe('unreadCount (the red dot)', () => {
  const log = [entry(10, 'requested'), entry(20, 'booked')];
  it('counts what happened since the admin last opened the panel', () => {
    expect(unreadCount(log, [request], profiles, profiles.lucia, 0, [weekly(30)], [task(40)])).toBe(4);
  });
  it('goes away once the panel was opened, even if requests are still waiting', () => {
    expect(unreadCount(log, [request], profiles, profiles.lucia, 50, [weekly(30)], [task(40)])).toBe(0);
  });
  it('comes back for anything new', () => {
    expect(unreadCount([...log, entry(60, 'requested')], [request], profiles, profiles.lucia, 50, [weekly(70)], [])).toBe(2);
  });
});
