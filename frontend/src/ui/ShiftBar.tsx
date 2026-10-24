import { useState } from 'react';
import type { Repo, SessionTodo } from '../data/repo';
import { currentShift, sessionState, type ShiftSession } from '../lib/session';
import { resolveTodos, type TodoTemplate } from '../lib/todos';
import type { Profile, Shift } from '../lib/shifts';
import { dur, hm } from '../lib/time';
import { errorText } from './errors';
import { Modal } from './Modal';

type Props = {
  repo: Repo; me: Profile; tz: string; now: number;
  shifts: Shift[]; sessions: ShiftSession[]; sessionTodos: SessionTodo[]; templates: TodoTemplate[];
  /** after "End shift": open the report for that shift with the worked minutes */
  onEnded: (shift: Shift, minutes: number) => void;
};

/** Start shift (green) / End shift (red), the shift's to-do list, and "Are you still working?". */
export function ShiftBar({ repo, me, tz, now, shifts, sessions, sessionTodos, templates, onEnded }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = sessions.find((s) => s.owner === me.id && sessionState(s, now).open);
  const shift = open ? shifts.find((s) => s.id === open.shiftId) : currentShift(shifts, me.id, now);
  if (!shift && !open) return null;
  const state = open ? sessionState(open, now) : null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e, tz)); } finally { setBusy(false); }
  }
  const end = () => run(async () => { await repo.endShift(open!.id); if (shift) onEnded(shift, state!.minutes); });

  const todos = open && shift ? resolveTodos(templates, shift) : [];
  const ticked = (t: string, i: number) => sessionTodos.some((x) => x.sessionId === open!.id && x.templateId === t && x.item === i);

  return (
    <section className={'shiftbar' + (open ? ' on' : '')} data-testid="shiftbar" data-tour="shiftbar">
      <div className="row">
        {open ? (<>
          <button className="btn shiftbtn end" type="button" disabled={busy} onClick={end}>End shift</button>
          <span><b>On shift</b> since {hm(open.startedAt, tz)} · {dur(state!.minutes)}{shift ? ` · booked until ${hm(shift.end, tz)}` : ''}</span>
        </>) : (<>
          <button className="btn shiftbtn start" type="button" disabled={busy} onClick={() => run(() => repo.startShift(shift!.id))}>Start shift</button>
          <span>Your shift {hm(shift!.start, tz)}–{hm(shift!.end, tz)} is on now.</span>
        </>)}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {open && (
        <div className="todobox" data-testid="todobox">
          <div className="eyebrow">To do in this shift</div>
          {!todos.length ? <p className="empty">No checklist for this shift.</p> : todos.map((t) => (
            <div key={t.id} className="todolist">
              {todos.length > 1 && <b>{t.title}</b>}
              <ul aria-label={t.title}>
                {t.items.map((item, i) => (
                  <li key={i} className={ticked(t.id, i) ? 'done' : ''}>
                    <label className="check">
                      <input type="checkbox" checked={ticked(t.id, i)} onChange={(e) => run(() => repo.toggleSessionTodo(open.id, t.id, i, e.target.checked))} />
                      {item}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {open && state!.asking && (
        <Modal label="Are you still working?" onClose={() => undefined}>
          <div><div className="eyebrow">Your shift ended at {shift ? hm(shift.end, tz) : hm(open.checkDueAt, tz)}</div><h2>Are you still working?</h2></div>
          <p>If you don’t answer by <b>{hm(state!.closesAt, tz)}</b>, your shift ends at <b>{hm(open.checkDueAt, tz)}</b> and the time after that is not counted.</p>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="actions">
            <button className="btn danger" type="button" disabled={busy} onClick={end}>No, end my shift</button>
            <span className="spacer" />
            <button className="btn primary" type="button" disabled={busy} onClick={() => run(() => repo.confirmShift(open.id))}>Yes</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
