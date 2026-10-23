import { coverageText, hasTarget, type Coverage, type Weekday } from '../lib/coverage';
import { canReport, historyText, latestEntryPerShift, personColor, weekHours, type LogEntry, type Profile, type Report, type Shift } from '../lib/shifts';
import { DAYS_LONG, dayLabel, dur, hm, tzLabel } from '../lib/time';
import { availableMinutes, type Availability } from '../lib/availability';
import { personName } from './Grid';
import { reportSummary } from './ReportEditor';

export function HoursPanel({ shifts, reports, availability, profiles, me, from, to, onExport }: { shifts: Shift[]; reports: Record<string, Report>; availability: Record<string, Availability>; profiles: Record<string, Profile>; me: Profile | null; from: number; to: number; onExport: () => void }) {
  const hours = weekHours(shifts, from, to, reports);
  const offered = Object.fromEntries(Object.entries(availability).map(([id, a]) => [id, availableMinutes(a, from, to)]));
  const rows = [...hours, ...Object.keys(offered).filter((id) => offered[id] > 0 && profiles[id]?.active && !hours.some((h) => h.owner === id))
    .map((owner) => ({ owner, booked: 0, covering: 0, open: 0, worked: 0, reported: 0 }))];
  return (
    <div className="panel wide">
      <div className="panel-head"><h2>Availability and hours this week</h2><button className="btn" type="button" onClick={onExport}>Export CSV</button></div>
      <div id="hours">
        {!rows.length ? <p className="empty">Nobody has booked availability this week yet.</p> : (<>
          <table>
            <thead><tr><th>Person</th><th className="num">Offered</th><th className="num">Shifts</th><th className="num">Covering</th><th className="num">Needs cover</th><th className="num">Worked</th></tr></thead>
            <tbody>
              {rows.map((h) => {
                const p = profiles[h.owner];
                return (
                  <tr key={h.owner}>
                    <td>
                      <div className="person"><span className="dot" style={{ background: personColor(p?.username || h.owner) }} /><span>{personName(profiles, h.owner, me)}</span></div>
                      <span className="sub">{p?.timezone ? tzLabel(p.timezone, from) : 'time zone not set'}</span>
                    </td>
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
          <p className="note">Offered is the availability each RCM gave for this week. Shifts are the hours booked or assigned. Worked is what RCMs logged in their shift reports.</p>
        </>)}
      </div>
    </div>
  );
}

export function CoveragePanel({ coverage, isAdmin, onEdit }: { coverage: Coverage | null; isAdmin: boolean; onEdit: () => void }) {
  return (
    <div className="panel">
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
};

/** Changes to shifts. Each shift's newest entry carries its report, editable by the owner and admins. */
export function HistoryPanel({ log, profiles, tz, shifts, reports, me, now, onReport }: HistoryProps) {
  const name = (id: string | null) => (id && profiles[id]?.fullName) || 'Someone';
  const items = [...log].sort((a, b) => b.at - a.at).slice(0, 80);
  const latest = latestEntryPerShift(log);
  const byId = new Map(shifts.map((s) => [s.id, s]));
  return (
    <div className="panel">
      <div className="panel-head"><h2>History</h2></div>
      <ul className="hist" id="history">
        {!items.length ? <li className="empty">Changes to shifts will appear here.</li> : items.map((l) => (
          <li key={l.id}>
            <time>{dayLabel(l.at, tz)} {hm(l.at, tz)}</time>
            <div>
              <span>{historyText(l, name, tz)}</span>
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
