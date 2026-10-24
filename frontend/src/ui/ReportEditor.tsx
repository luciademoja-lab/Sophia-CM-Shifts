import { useState } from 'react';
import type { Repo } from '../data/repo';
import type { Profile, Report, Shift } from '../lib/shifts';
import type { Task } from '../lib/tasks';
import { PRIORITY_LABEL } from '../lib/tasks';
import { WORK_TYPES, reportWeek, validateReport, workTypeLabel, type TaskTime, type WeeklyReport, type WorkType } from '../lib/work';
import { dur, rangeLabel } from '../lib/time';
import { errorText } from './errors';
import { personName } from './Grid';
import { Field, Modal } from './Modal';

type Props = {
  repo: Repo; shift: Shift; report: Report | undefined; tz: string; me: Profile; profiles: Record<string, Profile>;
  tasks: Task[]; weeklyReports: WeeklyReport[]; onClose: () => void;
  /** minutes clocked with Start/End shift, used when there is no report yet */
  workedMinutes?: number;
};

/** True when the SCM already sent the weekly report covering this shift (admins can still edit). */
export function reportLocked(shift: Shift, me: Profile, profiles: Record<string, Profile>, weekly: WeeklyReport[]): boolean {
  if (me.role !== 'rcm') return false;
  const week = reportWeek(shift.start, profiles[shift.owner]?.timezone || 'UTC');
  return weekly.some((w) => w.owner === shift.owner && w.week === week && w.status !== 'rejected');
}

const step5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/** The SCM (or an admin) logs the hours worked, the kinds of work done and the time on tasks. */
export function ReportEditor({ repo, shift, report, tz, me, profiles, tasks, weeklyReports, onClose, workedMinutes }: Props) {
  const booked = Math.round((shift.end - shift.start) / 60000);
  const initial = report ? report.workedMinutes : Math.min(24 * 60, Math.round((workedMinutes ?? booked) / 5) * 5);
  const [hours, setHours] = useState(Math.floor(initial / 60));
  const [minutes, setMinutes] = useState(initial % 60 - (initial % 5));
  const [types, setTypes] = useState<WorkType[]>(report?.workTypes || []);
  const [posters, setPosters] = useState(report?.posters || '');
  const [notes, setNotes] = useState(report?.notes || '');
  const [linked, setLinked] = useState<TaskTime[]>(report?.tasks || []);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const worked = Math.min(24 * 60, hours * 60 + minutes);
  const locked = reportLocked(shift, me, profiles, weeklyReports);
  const mine = tasks.filter((t) => t.assignees.some((a) => a.person === shift.owner));
  const title = (id: string) => tasks.find((t) => t.id === id)?.title || 'Task';

  const toggleType = (t: WorkType) => setTypes((list) => (list.includes(t) ? list.filter((x) => x !== t) : WORK_TYPES.filter((x) => x === t || list.includes(x))));
  // Linking a task splits the hours worked evenly between the linked tasks; the SCM can then adjust.
  const toggleTask = (id: string) => setLinked((list) => {
    const next = list.some((x) => x.taskId === id) ? list.filter((x) => x.taskId !== id) : [...list, { taskId: id, minutes: 0 }];
    const each = next.length ? step5(Math.floor(worked / next.length / 5) * 5) : 0;
    return next.map((x) => ({ ...x, minutes: Math.min(each, worked) || 5 }));
  });
  const setTaskMinutes = (id: string, m: number) => setLinked((list) => list.map((x) => (x.taskId === id ? { ...x, minutes: m } : x)));
  const onTasks = linked.reduce((m, x) => m + x.minutes, 0);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); onClose(); } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }
  function save() {
    const input = { workedMinutes: worked, notes, workTypes: types, posters, tasks: linked };
    const err = validateReport(input);
    if (err) { setError(err); return; }
    run(() => repo.saveReport(shift.id, input));
  }

  return (
    <Modal label="Report" wide onClose={onClose}>
      <div>
        <div className="eyebrow">Report</div>
        <h2>{personName(profiles, shift.owner, me)}</h2>
        <p className="note mono">{rangeLabel(shift.start, shift.end, tz)} · booked {dur(booked)}</p>
        {locked && <p className="warnline">You already sent the weekly report for this week, so this report is locked. Ask an admin if something needs fixing.</p>}
      </div>
      <fieldset className="plain" disabled={locked}>
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

        <div className="checks" role="group" aria-label="What did you do?">
          <span className="eyebrow">What did you do?</span>
          {WORK_TYPES.map((t) => (
            <label key={t} className="check"><input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} />{workTypeLabel(t)}</label>
          ))}
        </div>
        {types.includes('poster_issues') && (
          <Field label="Posters who had issues (required)" htmlFor="rp-posters">
            <input id="rp-posters" value={posters} maxLength={1000} onChange={(e) => setPosters(e.target.value)} placeholder="Names, separated by commas" />
          </Field>
        )}

        <div className="linked">
          <div className="row">
            <span className="eyebrow">Tasks</span>
            <button className="btn small" type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>{picking ? 'Done linking' : 'Link task'}</button>
          </div>
          {picking && (
            mine.length ? (
              <ul className="picklist" aria-label="Your tasks">
                {mine.map((t) => (
                  <li key={t.id}>
                    <label className="check"><input type="checkbox" checked={linked.some((x) => x.taskId === t.id)} onChange={() => toggleTask(t.id)} />
                      {t.title} <span className="muted">· {PRIORITY_LABEL[t.priority]} · est. {dur(t.estimateMinutes)}</span></label>
                  </li>
                ))}
              </ul>
            ) : <p className="empty">No tasks assigned{shift.owner === me.id ? ' to you' : ''} yet.</p>
          )}
          {linked.map((x) => (
            <div key={x.taskId} className="row">
              <span className="grow">{title(x.taskId)}</span>
              <label className="sr-only" htmlFor={'rp-t-' + x.taskId}>Minutes on {title(x.taskId)}</label>
              <select id={'rp-t-' + x.taskId} value={x.minutes} onChange={(e) => setTaskMinutes(x.taskId, +e.target.value)}>
                {Array.from({ length: Math.max(1, worked / 5) }, (_, k) => (k + 1) * 5).concat(x.minutes > worked ? [x.minutes] : []).map((m) => <option key={m} value={m}>{dur(m)}</option>)}
              </select>
            </div>
          ))}
          {linked.length > 0 && <p className={onTasks > worked ? 'err' : 'note'}>{dur(onTasks)} of {dur(worked)} on tasks.</p>}
        </div>

        <Field label="Anything more specific? (optional)" htmlFor="rp-notes">
          <textarea id="rp-notes" rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. escalated 1 OS ticket about login" />
        </Field>
      </fieldset>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        {report && !locked && <button className="btn danger" type="button" disabled={busy} onClick={() => run(() => repo.deleteReport(shift.id))}>Remove report</button>}
        <span className="spacer" />
        <button className="btn" type="button" onClick={onClose}>{locked ? 'Close' : 'Cancel'}</button>
        {!locked && <button className="btn primary" type="button" disabled={busy} onClick={save}>Save report</button>}
      </div>
    </Modal>
  );
}

/** "Worked 4h 30m (booked 6h) · Onboarding, Posters' issues (Ana) · notes" */
export function reportSummary(r: Report, bookedMs: number | null): string {
  const b = bookedMs != null ? ` (booked ${dur(Math.round(bookedMs / 60000))})` : '';
  const kinds = (r.workTypes || []).map((t) => (t === 'poster_issues' && r.posters ? `${workTypeLabel(t)} (${r.posters})` : workTypeLabel(t))).join(', ');
  return `Worked ${dur(r.workedMinutes)}${b}${kinds ? ' · ' + kinds : ''}${r.notes ? ' · ' + r.notes : ''}`;
}
