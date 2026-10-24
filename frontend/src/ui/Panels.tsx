import { coverageText, hasTarget, type Coverage, type Weekday } from '../lib/coverage';
import { useState } from 'react';
import { shareRcms, teamColors } from '../lib/team';
import { canReport, historyFor, historyText, latestEntryPerShift , weekHours, type LogEntry, type Profile, type Report, type Shift } from '../lib/shifts';
import { DAYS_LONG, dayLabel, dur, hm, rangeLabel, tzLabel } from '../lib/time';
import type { WeeklyReport } from '../lib/work';
import { availableMinutes, type Availability } from '../lib/availability';
import type { Plan, Suggestion } from '../lib/plan';
import { errorText } from './errors';
import { personName } from './Grid';
import { reportLocked, reportSummary } from './ReportEditor';

type HoursProps = {
  shifts: Shift[]; reports: Record<string, Report>; availability: Record<string, Availability>; profiles: Record<string, Profile>;
  me: Profile | null; from: number; to: number; now: number; tz: string; weeklyReports: WeeklyReport[];
  onExport: () => void; onReport: (s: Shift) => void; onDeleteReport: (s: Shift) => Promise<void>;
  /** each SCM's share of the week's required hours, in minutes */
  share: number;
};

export function HoursPanel({ shifts, reports, availability, profiles, me, from, to, now, tz, weeklyReports, onExport, onReport, onDeleteReport, share }: HoursProps) {
  const sharers = new Set(shareRcms(profiles).map((p) => p.id));
  const own = me?.role === 'rcm';
  const hours = weekHours(shifts, from, to, reports);
  const offered = Object.fromEntries(Object.entries(availability).map(([id, a]) => [id, availableMinutes(a, from, to)]));
  const rows = [...hours, ...Object.keys(offered).filter((id) => offered[id] > 0 && profiles[id]?.active && !hours.some((h) => h.owner === id))
    .map((owner) => ({ owner, booked: 0, covering: 0, open: 0, pending: 0, worked: 0, reported: 0 }))]
    .filter((h) => !own || h.owner === me!.id);
  // SCMs: their own started shifts this week, to add or remove reports
  const mine = own ? shifts.filter((x) => x.owner === me!.id && x.start >= from && x.start < to && x.start <= now && (x.status === 'booked' || x.status === 'open')).sort((a, b) => a.start - b.start) : [];
  const [armed, setArmed] = useState<string | null>(null);
  return (
    <div className="panel wide" data-tour="hours">
      <div className="panel-head"><h2>{own ? 'My availability and hours this week' : 'Availability and hours this week'}</h2>{!own && <button className="btn" type="button" onClick={onExport}>Export CSV</button>}</div>
      <div id="hours">
        {!rows.length ? <p className="empty">{own ? 'No availability or shifts this week yet.' : 'Nobody has booked availability this week yet.'}</p> : (<>
          <table>
            <thead><tr><th>Person</th><th className="num">Target</th><th className="num">Offered</th><th className="num">Shifts</th><th className="num">Covering</th><th className="num">Needs cover</th><th className="num">Worked</th></tr></thead>
            <tbody>
              {rows.map((h) => {
                const p = profiles[h.owner];
                return (
                  <tr key={h.owner}>
                    <td>
                      <div className="person"><span className="dot" style={{ background: teamColors(profiles)[h.owner] }} /><span>{personName(profiles, h.owner, me)}</span></div>
                      <span className="sub">{p?.timezone ? tzLabel(p.timezone, from) : 'time zone not set'}</span>
                    </td>
                    <td className="num">{share && sharers.has(h.owner) ? dur(share) : '–'}</td>
                    <td className="num">{offered[h.owner] ? dur(offered[h.owner]) : '–'}</td>
                    <td className="num">{h.booked ? dur(h.booked / 60000) : '–'}</td>
                    <td className="num">{h.covering ? dur(h.covering / 60000) : '–'}</td>
                    <td className="num">{h.open ? dur(h.open / 60000) : '–'}</td>
                    <td className="num">{h.reported ? dur(h.worked / 60000) : '–'}{h.reported ? <span className="sub">{h.reported} report{h.reported > 1 ? 's' : ''}</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="note">Target is each SCM’s share of the required hours (required hours ÷ number of SCMs). Offered is the availability {own ? 'you' : 'each SCM'} gave for this week. Shifts are the hours booked or assigned. Worked is what {own ? 'you' : 'SCMs'} logged in shift reports.</p>
        </>)}
        {own && (
          <div className="myshifts">
            <h3>My shift reports</h3>
            {!mine.length ? <p className="empty">Reports open once a shift has started.</p> : (
              <ul className="hist" data-testid="my-reports">
                {mine.map((x) => {
                  const rp = reports[x.id];
                  const locked = !!me && reportLocked(x, me, profiles, weeklyReports);
                  return (
                    <li key={x.id}>
                      <time>{rangeLabel(x.start, x.end, tz)}</time>
                      <div>
                        <span>{rp ? reportSummary(rp, x.end - x.start) : 'No report yet'}</span>
                        <div className="report">
                          {locked ? <span className="muted">Sent in the weekly report</span> : (<>
                            <button className="btn small" type="button" onClick={() => onReport(x)}>{rp ? 'Edit report' : 'Add report'}</button>
                            {rp && <button className="btn small danger" type="button" onClick={() => { if (armed === x.id) { setArmed(null); onDeleteReport(x).catch(() => undefined); } else setArmed(x.id); }}>{armed === x.id ? 'Click again to delete' : 'Delete report'}</button>}
                          </>)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CoveragePanel({ coverage, isAdmin, onEdit }: { coverage: Coverage | null; isAdmin: boolean; onEdit: () => void }) {
  return (
    <div className="panel" data-tour="coverage">
      <div className="panel-head"><h2>Required coverage</h2>{isAdmin && <button className="btn" type="button" onClick={onEdit}>Edit</button>}</div>
      <div id="coverage">
        {!hasTarget(coverage) ? (
          <p className="empty">{isAdmin ? 'No coverage target yet. Click Edit to set the hours that must always have someone on duty. Gaps then show in red.' : 'No coverage target set yet.'}</p>
        ) : (<>
          <div className="covlist">
            {DAYS_LONG.map((d, i) => {
              const slots = coverage!.days[(i + 1) as Weekday];
              return [<span key={d}>{d}</span>, <span key={d + 'v'} className={slots?.length ? 'mono' : 'muted'}>{coverageText(slots)}</span>];
            })}
          </div>
          <p className="note">Set in {coverage!.tz} time.</p>
        </>)}
      </div>
    </div>
  );
}

type HistoryProps = {
  log: LogEntry[]; profiles: Record<string, Profile>; tz: string;
  shifts: Shift[]; reports: Record<string, Report>; me: Profile | null; now: number;
  onReport: (s: Shift) => void;
  /** admins only: remove an entry */
  onDelete?: (id: string) => Promise<void>;
};

/** Changes to shifts. Each shift's newest entry carries its report, editable by the owner and admins. */
export function HistoryPanel({ log, profiles, tz, shifts, reports, me, now, onReport, onDelete }: HistoryProps) {
  const name = (id: string | null) => (id && profiles[id]?.fullName) || 'Someone';
  const [person, setPerson] = useState('');
  const seesAll = me?.role === 'admin' || me?.role === 'viewer';
  const choices = Object.values(profiles).filter((p) => p.role !== 'viewer').sort((a, b) => a.fullName.localeCompare(b.fullName));
  const [armed, setArmed] = useState<string | null>(null);
  const items = historyFor(log, me, seesAll ? person || null : null).sort((a, b) => b.at - a.at).slice(0, 80);
  const latest = latestEntryPerShift(log);
  const byId = new Map(shifts.map((s) => [s.id, s]));
  return (
    <div className="panel" data-tour="history">
      <div className="panel-head">
        <h2>History</h2>
        {seesAll && (
          <div className="histfilter">
            <label className="eyebrow" htmlFor="hist-person">Show</label>
            <select id="hist-person" value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Everyone</option>
              {choices.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </div>
        )}
      </div>
      <ul className="hist" id="history">
        {!items.length ? <li className="empty">Changes to shifts will appear here.</li> : items.map((l) => (
          <li key={l.id}>
            <time>{dayLabel(l.at, tz)} {hm(l.at, tz)}</time>
            <div>
              <span>{historyText(l, name, tz)}</span>
              {onDelete && (
                <button type="button" className="del" aria-label={armed === l.id ? 'Click again to delete this entry' : 'Delete this entry'} title={armed === l.id ? 'Click again to delete' : 'Delete entry'}
                  onClick={() => { if (armed === l.id) { setArmed(null); onDelete(l.id).catch(() => undefined); } else setArmed(l.id); }}
                >{armed === l.id ? 'Delete?' : '×'}</button>
              )}
              {l.shiftId && latest.has(l.id) && (() => {
                const r = reports[l.shiftId], s = byId.get(l.shiftId);
                const editable = !!s && canReport(s, me, now);
                if (!r && !editable) return null;
                return (
                  <div className="report">
                    {r && <span>{reportSummary(r, s ? s.end - s.start : l.end - l.start)}</span>}
                    {editable && <button className="btn small" type="button" onClick={() => onReport(s!)}>{r ? 'Edit report' : 'Add report'}</button>}
                  </div>
                );
              })()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type PlanProps = {
  plan: Plan; profiles: Record<string, Profile>; tz: string;
  showGhosts: boolean; onToggleGhosts: () => void;
  onAssign: (s: Suggestion) => Promise<void>;
  onAssignAll: () => Promise<void>;
};

/** Admins: required hours this week, what each SCM offered, and a balanced suggestion. */
export function PlanPanel({ plan, profiles, tz, showGhosts, onToggleGhosts, onAssign, onAssignAll }: PlanProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => profiles[id]?.fullName || 'Someone';
  const open = plan.requiredMinutes - plan.coveredMinutes;
  const go = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e, tz)); } finally { setBusy(false); }
  };
  return (
    <div className="panel wide plan" id="plan" data-tour="plan">
      <div className="panel-head">
        <h2>Suggested plan</h2>
        <div className="row">
          {plan.suggestions.length > 0 && <button className="btn" type="button" onClick={onToggleGhosts}>{showGhosts ? 'Hide on grid' : 'Show on grid'}</button>}
          {plan.suggestions.length > 0 && <button className="btn primary" type="button" disabled={busy} onClick={() => go(onAssignAll)}>Assign all</button>}
        </div>
      </div>
      {plan.requiredMinutes === 0 ? <p className="empty">Set the required coverage to get suggestions.</p> : (<>
        <div className="nums">
          <div><span className="eyebrow">Required</span><b>{dur(plan.requiredMinutes)}</b></div>
          <div><span className="eyebrow">Covered</span><b>{dur(plan.coveredMinutes)}</b></div>
          <div><span className="eyebrow">Still open</span><b>{dur(open)}</b></div>
          <div><span className="eyebrow">Nobody available</span><b className={plan.noOneMinutes ? 'bad' : ''}>{plan.noOneMinutes ? dur(plan.noOneMinutes) : '–'}</b></div>
        </div>
        <table>
          <thead><tr><th>SCM</th><th className="num">Offered on open hours</th><th className="num">Booked</th><th className="num">Suggested</th><th className="num">Total</th></tr></thead>
          <tbody>
            {plan.perPerson.map((p) => (
              <tr key={p.id}>
                <td><div className="person"><span className="dot" style={{ background: teamColors(profiles)[p.id] }} />{name(p.id)}</div></td>
                <td className="num">{p.offeredMinutes ? dur(p.offeredMinutes) : '–'}</td>
                <td className="num">{p.bookedMinutes ? dur(p.bookedMinutes) : '–'}</td>
                <td className="num">{p.targetMinutes ? '+' + dur(p.targetMinutes) : '–'}</td>
                <td className="num">{dur(p.bookedMinutes + p.targetMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {plan.suggestions.length ? (
          <ul aria-label="Suggested shifts">
            {plan.suggestions.map((s) => (
              <li key={s.owner + s.start}>
                <span className="dot" style={{ background: teamColors(profiles)[s.owner] }} />
                <span>{name(s.owner)} · <span className="mono">{dayLabel(s.start, tz)} {hm(s.start, tz)}–{hm(s.end, tz)}</span> · {dur((s.end - s.start) / 60000)}</span>
                <button className="btn small" type="button" disabled={busy} onClick={() => go(() => onAssign(s))}>Assign</button>
              </li>
            ))}
          </ul>
        ) : <p className="empty">{open ? 'Nobody is available for the hours still open.' : 'All required hours are covered.'}</p>}
        <p className="note">The plan shares the open required hours so everyone's total for the week is as even as their availability allows. SCMs available only a few hours get all of them. Suggested shifts are at least 30 minutes.</p>
        {error && <p className="err" role="alert">{error}</p>}
      </>)}
    </div>
  );
}
