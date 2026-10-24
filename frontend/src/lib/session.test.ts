import { describe, it, expect } from 'vitest';
import { currentShift, sessionState, CHECK_EVERY, type ShiftSession } from './session';
import type { Shift } from './shifts';

const M = 60_000, H = 60 * M;
const shift: Shift = { id: 's1', owner: 'r', start: 10 * H, end: 14 * H, status: 'booked', coversId: null };
const session = (extra: Partial<ShiftSession> = {}): ShiftSession =>
  ({ id: 'x', shiftId: 's1', owner: 'r', startedAt: 10 * H + 5 * M, endedAt: null, checkDueAt: 14 * H, endedBy: null, ...extra });

describe('currentShift (when "Start shift" shows)', () => {
  it('is the SCM\'s own booked shift going on now', () => {
    expect(currentShift([shift], 'r', 11 * H)?.id).toBe('s1');
    expect(currentShift([shift], 'r', 9 * H)).toBeUndefined();
    expect(currentShift([shift], 'r', 14 * H)).toBeUndefined();
    expect(currentShift([shift], 'k', 11 * H)).toBeUndefined();
    expect(currentShift([{ ...shift, status: 'pending' }], 'r', 11 * H)).toBeUndefined();
  });
});

describe('sessionState', () => {
  it('runs until the end of the shift without asking', () => {
    expect(sessionState(session(), 12 * H)).toMatchObject({ open: true, asking: false, minutes: 115 });
  });
  it('asks "Are you still working?" once the shift is over', () => {
    expect(sessionState(session(), 14 * H + 10 * M)).toMatchObject({ open: true, asking: true, closesAt: 14 * H + 30 * M });
  });
  it('after a Yes, asks again 30 minutes later', () => {
    const s = session({ checkDueAt: 14 * H + 10 * M + CHECK_EVERY });
    expect(sessionState(s, 14 * H + 20 * M)).toMatchObject({ open: true, asking: false });
    expect(sessionState(s, 14 * H + 45 * M)).toMatchObject({ open: true, asking: true });
  });
  it('ends at the time of the question when nobody answers for 30 minutes (those minutes do not count)', () => {
    expect(sessionState(session(), 14 * H + 31 * M)).toMatchObject({ open: false, endedAt: 14 * H, endedBy: 'timeout', minutes: 235 });
  });
  it('counts the minutes of a session ended by the SCM', () => {
    expect(sessionState(session({ endedAt: 13 * H + 5 * M, endedBy: 'user' }), 20 * H)).toMatchObject({ open: false, minutes: 180 });
  });
});
