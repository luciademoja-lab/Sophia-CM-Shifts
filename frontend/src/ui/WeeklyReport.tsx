import { useMemo, useState } from 'react';
import type { Repo } from '../data/repo';
import type { Profile, Report, Shift } from '../lib/shifts';
import type { Task } from '../lib/tasks';
import { canSubmitWeekly, weeklyMessage, weeklyMinutes, weeklyOpensAt, type WeeklyReport } from '../lib/work';
import { addDays, dayLabel, dur, hm, parseDateValue, shortDate } from '../lib/time';
import { errorText } from './errors';
import { Modal } from './Modal';

type Props = {
  repo: Repo; me: Profile; profiles: Record<string, Profile>; week: string; now: number;
  shifts: Shift[]; reports: Record<string, Report>; tasks: Task[]; weekly: WeeklyReport | undefined; onClose: () => void;
};

/** RCMs: from Sunday, check the pre-written summary of their reported hours and send it to the admins. */
export function WeeklyReportModal({ repo, me, profiles, week, now, shifts, reports, tasks, weekly, onClose }: Props) {
  const tz = me.timezone || 'UTC';
  const draft = useMemo(() => weeklyMessage({
    owner: me.id, name: me.fullName, week, tz, shifts, reports, taskTitles: Object.fromEntries(tasks.map((t) => [t.id, t.title])),
  }), [me, week, tz, shifts, reports, tasks]);
  // follows the reports until the RCM edits it
  const [edited, setEdited] = useState<string | null>(weekly && weekly.status !== 'rejected' ? weekly.message : null);
  const message = edited ?? draft;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = weeklyMinutes(me.id, week, tz, shifts, reports);
  const open = canSubmitWeekly(week, tz, now);
  const mon = parseDateValue(week)!;
  const opens = weeklyOpensAt(week, tz);
  const approvedBy = weekly?.decidedBy ? profiles[weekly.decidedBy]?.fullName || 'an admin' : 'an admin';

  async function send() {
    setBusy(true); setError(null);
    try { await repo.submitWeekly(week, message); onClose(); } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }

  return (
    <Modal label="Weekly report" wide onClose={onClose}>
      <div>
        <div className="eyebrow">Weekly report</div>
        <h2>{shortDate(mon)} – {shortDate(addDays(mon, 6))}</h2>
        <p className="note">Hours reported this week: <b data-testid="weekly-total">{dur(total)}</b>. Only the hours in your shift reports count, not the booked ones.</p>
      </div>

      {weekly?.status === 'approved' ? (
        <div className="okbox" data-testid="weekly-approved">
          <b>Approved by {approvedBy}.</b> Now add <b>{dur(weekly.workedMinutes)}</b> for this week to your Upwork contract.
        </div>
      ) : weekly?.status === 'submitted' ? (
        <p className="note" data-testid="weekly-sent">Sent {dayLabel(weekly.submittedAt, tz)} {hm(weekly.submittedAt, tz)}, waiting for an admin. You can still change it and send it again.</p>
      ) : weekly?.status === 'rejected' ? (
        <p className="warnline">An admin sent this report back. Check your shift reports, then send it again.</p>
      ) : null}

      {weekly?.status === 'approved' ? (
        <pre className="weeklymsg">{weekly.message}</pre>
      ) : (<>
        <label className="eyebrow" htmlFor="wk-message">Message to the admins</label>
        <textarea id="wk-message" rows={14} maxLength={8000} value={message} onChange={(e) => setEdited(e.target.value)} />
        <div className="row">
          <button className="linkbtn" type="button" onClick={() => setEdited(null)}>Rebuild from my reports</button>
        </div>
        {!open && <p className="warnline" data-testid="weekly-closed">You can send it from {dayLabel(opens, tz)} (your time). Hours are reported on Sunday for the whole week.</p>}
      </>)}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        <span className="spacer" />
        <button className="btn" type="button" onClick={onClose}>Close</button>
        {weekly?.status !== 'approved' && <button className="btn primary" type="button" disabled={busy || !open} onClick={send}>{weekly?.status === 'submitted' ? 'Send again' : 'Send to admins'}</button>}
      </div>
    </Modal>
  );
}
