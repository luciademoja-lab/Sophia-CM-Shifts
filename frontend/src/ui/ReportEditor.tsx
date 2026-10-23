import { useState } from 'react';
import type { Repo } from '../data/repo';
import type { Profile, Report, Shift } from '../lib/shifts';
import { dur, rangeLabel } from '../lib/time';
import { errorText } from './errors';
import { personName } from './Grid';
import { Field, Modal } from './Modal';

/** The RCM (or an admin) logs what was done in a shift and the hours actually worked. */
export function ReportEditor({ repo, shift, report, tz, me, profiles, onClose }: {
  repo: Repo; shift: Shift; report: Report | undefined; tz: string; me: Profile; profiles: Record<string, Profile>; onClose: () => void;
}) {
  const booked = Math.round((shift.end - shift.start) / 60000);
  const initial = report ? report.workedMinutes : booked;
  const [hours, setHours] = useState(Math.floor(initial / 60));
  const [minutes, setMinutes] = useState(initial % 60 - (initial % 5));
  const [notes, setNotes] = useState(report?.notes || '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const worked = Math.min(24 * 60, hours * 60 + minutes);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); onClose(); } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }

  return (
    <Modal label="Report" onClose={onClose}>
      <div>
        <div className="eyebrow">Report</div>
        <h2>{personName(profiles, shift.owner, me)}</h2>
        <p className="note mono">{rangeLabel(shift.start, shift.end, tz)} · booked {dur(booked)}</p>
      </div>
      <div className="fields two">
        <Field label="Hours worked" htmlFor="rp-hours">
          <select id="rp-hours" value={hours} onChange={(e) => setHours(+e.target.value)}>
            {Array.from({ length: 25 }, (_, h) => <option key={h} value={h}>{h} h</option>)}
          </select>
        </Field>
        <Field label="Minutes" htmlFor="rp-minutes">
          <select id="rp-minutes" value={minutes} onChange={(e) => setMinutes(+e.target.value)}>
            {Array.from({ length: 12 }, (_, k) => <option key={k} value={k * 5}>{k * 5} min</option>)}
          </select>
        </Field>
      </div>
      <p className="note">Log the time you actually worked, even if it differs from the booked slot{worked !== booked ? ` (${worked > booked ? '+' : '−'}${dur(Math.abs(worked - booked))} vs booked)` : ''}.</p>
      <Field label="What did you do?" htmlFor="rp-notes">
        <textarea id="rp-notes" rows={5} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. answered Zone A questions, onboarded 3 posters, escalated 1 OS ticket" />
      </Field>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        {report && <button className="btn danger" type="button" disabled={busy} onClick={() => run(() => repo.deleteReport(shift.id))}>Remove report</button>}
        <span className="spacer" />
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={busy} onClick={() => run(() => repo.saveReport(shift.id, worked, notes))}>Save report</button>
      </div>
    </Modal>
  );
}

/** "Worked 4h 30m (booked 6h) · notes" */
export function reportSummary(r: Report, bookedMs: number | null): string {
  const b = bookedMs != null ? ` (booked ${dur(Math.round(bookedMs / 60000))})` : '';
  return `Worked ${dur(r.workedMinutes)}${b}${r.notes ? ' · ' + r.notes : ''}`;
}
