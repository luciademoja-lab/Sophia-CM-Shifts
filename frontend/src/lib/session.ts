// Clocking in and out of a shift. After the shift ends the SCM is asked "Are you still working?";
// each Yes asks again 30 minutes later. With no answer for 30 minutes the session ends at the
// moment of the question, so the unanswered minutes are not counted.
import type { Shift } from './shifts';

export const CHECK_EVERY = 30 * 60_000;
export const ANSWER_WITHIN = 30 * 60_000;

export type ShiftSession = {
  id: string;
  shiftId: string;
  owner: string;
  startedAt: number;
  endedAt: number | null;
  /** when the next "Are you still working?" is due (the shift end, then 30 min after each Yes) */
  checkDueAt: number;
  endedBy: 'user' | 'timeout' | null;
};

/** The SCM's own booked shift going on right now. */
export function currentShift(shifts: Shift[], owner: string, now: number): Shift | undefined {
  return shifts.find((s) => s.owner === owner && s.status === 'booked' && s.start <= now && now < s.end);
}

export type SessionState = {
  open: boolean;
  /** the question is on screen */
  asking: boolean;
  /** if nobody answers, the session ends at the question time at this moment */
  closesAt: number;
  endedAt: number | null;
  endedBy: ShiftSession['endedBy'];
  /** minutes worked so far (or in total once ended) */
  minutes: number;
};

export function sessionState(s: ShiftSession, now: number): SessionState {
  const closesAt = s.checkDueAt + ANSWER_WITHIN;
  if (s.endedAt == null && now >= closesAt) {
    return { open: false, asking: false, closesAt, endedAt: s.checkDueAt, endedBy: 'timeout', minutes: Math.max(0, Math.round((s.checkDueAt - s.startedAt) / 60_000)) };
  }
  const end = s.endedAt ?? now;
  return {
    open: s.endedAt == null, asking: s.endedAt == null && now >= s.checkDueAt, closesAt,
    endedAt: s.endedAt, endedBy: s.endedBy, minutes: Math.max(0, Math.round((end - s.startedAt) / 60_000)),
  };
}
