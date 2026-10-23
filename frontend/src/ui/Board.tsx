import { useEffect, useMemo, useState } from 'react';
import type { Repo, Snapshot } from '../data/repo';
import { hasTarget, uncoveredRuns } from '../lib/coverage';
import { activeShifts, canWrite, findOverlap, onDutyAt, openInRange, personColor, toCsv, type Profile, type Shift } from '../lib/shifts';
import { availabilityIntervals, emptyAvailability } from '../lib/availability';
import { addDays, dayStartMs, dur, isoWeek, rangeLabel, shortDate, type PlainDate } from '../lib/time';
import { CoverageEditor } from './CoverageEditor';
import { errorText } from './errors';
import { Grid, personName, type Overlay } from './Grid';
import { AvailabilityForm } from './AvailabilityForm';
import { Modal } from './Modal';
import { CoveragePanel, HistoryPanel, HoursPanel, PlanPanel } from './Panels';
import { NotificationsModal, unreadCount } from './Notifications';
import { suggestPlan, type Suggestion } from '../lib/plan';
import { ShiftEditor, type EditorCtx } from './ShiftEditor';
import { TeamModal } from './TeamModal';
import { TimezonePicker } from './TimezonePicker';
import { ReportEditor } from './ReportEditor';
import { WeeklyReportModal } from './WeeklyReport';
import { TasksPage } from './TasksPage';
import { Dashboard } from './Dashboard';
import { RolePage } from './RolePage';
import { dateValue } from '../lib/time';

type Props = { repo: Repo; snap: Snapshot; tz: string; mon: PlainDate; onWeek: (delta: number | null) => void; loadError: string | null };
type Dialog = { kind: 'shift'; ctx: EditorCtx } | { kind: 'report'; shift: Shift } | { kind: 'coverage' } | { kind: 'team' } | { kind: 'tz' } | { kind: 'availability'; owner: Profile } | { kind: 'notifications' } | { kind: 'weekly' } | null;
type Page = 'schedule' | 'tasks' | 'dashboard' | 'role';
type Toast = { msg: string; undo?: () => Promise<unknown> } | null;

export function Board({ repo, snap, tz, mon, onWeek, loadError }: Props) {
  const { me, profiles, shifts, coverage, log, reports, availability, requests, notificationsSeenAt, tasks, taskTime, taskLog, weeklyReports } = snap;
  const isAdmin = me?.role === 'admin';
  const canBook = canWrite(me);
  const isViewer = me?.role === 'viewer';
  const [dialog, setDialog] = useState<Dialog>(null);
  const isRcm = me?.role === 'rcm';
  const pages: Array<[Page, string]> = [['schedule', 'Schedule'], ...(isViewer ? [] : [['tasks', isRcm ? 'My tasks' : 'Tasks'] as [Page, string]]),
    ...(isAdmin ? [['dashboard', 'Dashboard'] as [Page, string]] : []), ...(isRcm ? [['role', 'My role'] as [Page, string]] : [])];
  const [page, setPage] = useState<Page>('schedule');
  const [toast, setToast] = useState<Toast>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); }, [toast]);

  const w0 = dayStartMs(mon, tz), w1 = dayStartMs(addDays(mon, 7), tz);
  const sun = addDays(mon, 6);
  const act = activeShifts(shifts);
  const booked = act.filter((s) => s.status === 'booked');
  const uncovered = Array.from({ length: 7 }, (_, i) => uncoveredRuns(addDays(mon, i), tz, coverage, booked))
    .flat().reduce((m, r) => m + (r.to - r.from) * 15, 0);
  const onDuty = onDutyAt(shifts, now);
  const open = openInRange(shifts, w0, w1);
  const name = (id: string) => personName(profiles, id, me);

  // Who can hold shifts, and whose availability the board shows.
  const rcms = Object.values(profiles).filter((p) => p.active && p.role === 'rcm').sort((a, b) => a.fullName.localeCompare(b.fullName));
  const fixedToSelf = me?.role === 'rcm';
  const [view, setView] = useState<string>(() => (fixedToSelf && me ? me.id : 'team'));
  const shown = fixedToSelf ? me!.id : view;
  const intervalsOf = (id: string) => availabilityIntervals(availability[id] || emptyAvailability(profiles[id]?.timezone ?? null), w0, w1);
  const overlay: Overlay = shown === 'team'
    ? { mode: 'lanes', people: rcms.map((p) => ({ id: p.id, name: p.fullName, color: personColor(p.username), intervals: intervalsOf(p.id) })) }
    : profiles[shown]
      ? { mode: 'single', people: [{ id: shown, name: profiles[shown].fullName, color: personColor(profiles[shown].username), intervals: intervalsOf(shown) }] }
      : { mode: 'single', people: [] };
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  // Admins: balanced suggestion for the required hours still open this week (from now on).
  const plan = useMemo(() => {
    if (!isAdmin || !coverage) return null;
    const from = Math.max(w0, Math.ceil(now / 900_000) * 900_000);
    const required = availabilityIntervals({ tz: coverage.tz, week: coverage.days, days: {} }, w0, w1)
      .map((iv) => ({ start: Math.max(iv.start, from), end: iv.end })).filter((iv) => iv.end > iv.start);
    return suggestPlan({ required, shifts: shifts.filter((s) => s.end > w0 && s.start < w1), people: rcms.map((p) => ({ id: p.id, intervals: intervalsOf(p.id) })), minMinutes: 30 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, coverage, shifts, availability, profiles, w0, w1, Math.floor(now / 900_000)]);
  const [showGhosts, setShowGhosts] = useState(true);
  const ghosts = plan && showGhosts && shown === 'team' ? plan.suggestions : [];
  const assign = (g: Suggestion) => repo.bookShift(g.start, g.end, g.owner === me?.id ? null : g.owner).then(() => undefined);
  async function assignAll() {
    for (const g of plan?.suggestions || []) await assign(g);
  }
  const unread = isAdmin ? unreadCount(log, requests, profiles, me, notificationsSeenAt, weeklyReports, taskLog) : 0;
  const weekKey = dateValue(mon);
  const myWeekly = isRcm ? weeklyReports.find((w) => w.owner === me!.id && w.week === weekKey) : undefined;

  const editableAvailability = me && shown !== 'team' && profiles[shown] && (shown === me.id ? me.role === 'rcm' || me.role === 'admin' : isAdmin) ? profiles[shown] : null;

  async function quickDelete(s: Shift) {
    try {
      await repo.deleteShift(s.id);
      const label = `${name(s.owner)}'s shift, ${rangeLabel(s.start, s.end, tz)}`;
      setToast({
        msg: `Deleted ${label}.`,
        undo: s.coversId || s.status !== 'booked' ? undefined : async () => {
          const o = findOverlap(shifts.filter((x) => x.id !== s.id), s.start, s.end, []);
          if (o) { setToast({ msg: `Can't restore: ${name(o.owner)} has booked that time.` }); return; }
          await repo.bookShift(s.start, s.end, s.owner === me?.id ? null : s.owner, true);
        },
      });
    } catch (e) { setToast({ msg: errorText(e, tz) }); }
  }

  function exportCsv() {
    const csv = toCsv(shifts, profiles, w0, w1, tz, reports);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `rcm-shifts-week-${isoWeek(mon)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <div className="eyebrow">Vik Studios · Recruiter &amp; Community Managers</div>
          <h1>RCM Shifts</h1>
          <div className="muted">
            <span>Times shown in your time zone: {tz}</span>{' '}
            <button type="button" className="linkbtn" onClick={() => setDialog({ kind: 'tz' })}>Change</button>
            {me && <> · <span>Signed in as {me.fullName}, {isAdmin ? 'admin' : isViewer ? 'read-only' : 'RCM'}</span></>}
          </div>
        </div>
        <div className="userbar">
          <div className="weeknav">
            <button className="btn" type="button" aria-label="Previous week" onClick={() => onWeek(-1)}>←</button>
            <div className="weeklabel">Week {isoWeek(mon)} · {shortDate(mon)} – {shortDate(sun)}</div>
            <button className="btn" type="button" aria-label="Next week" onClick={() => onWeek(1)}>→</button>
            <button className="btn" type="button" onClick={() => onWeek(null)}>This week</button>
          </div>
          {editableAvailability && (
            <button className="btn" type="button" onClick={() => setDialog({ kind: 'availability', owner: editableAvailability })}>
              {editableAvailability.id === me?.id ? 'My availability' : `Edit ${editableAvailability.fullName.split(' ')[0]}'s availability`}
            </button>
          )}
          {isRcm && (
            <button className="btn" type="button" onClick={() => setDialog({ kind: 'weekly' })}>
              Weekly report{myWeekly ? <span className={'pill ' + myWeekly.status}>{{ submitted: 'sent', approved: 'approved', rejected: 'sent back' }[myWeekly.status]}</span> : null}
            </button>
          )}
          {isAdmin && (
            <button className="btn" type="button" aria-label={`Notifications${unread ? `, ${unread} new` : ''}`} onClick={() => setDialog({ kind: 'notifications' })}>
              Notifications{unread > 0 && <span className="badge" data-testid="notif-badge">{unread}</span>}
            </button>
          )}
          {isAdmin && <button className="btn" type="button" onClick={() => setDialog({ kind: 'team' })}>Team</button>}
          <button className="btn" type="button" onClick={() => repo.signOut()}>Sign out</button>
        </div>
      </header>

      {isViewer && <div className="banner">You have read-only access: you can see the board, the history and the reports, but not change them.</div>}
      {repo.mode === 'demo' && <div className="banner">Demo mode: data lives in this tab only and resets when you reload.</div>}
      {loadError && <div className="banner err">{loadError}</div>}

      {pages.length > 1 && (
        <nav className="pagetabs" aria-label="Pages">
          {pages.map(([k, label]) => <button key={k} type="button" aria-current={page === k ? 'page' : undefined} onClick={() => setPage(k)}>{label}</button>)}
        </nav>
      )}

      {page === 'tasks' && me && <TasksPage repo={repo} me={me} profiles={profiles} tasks={tasks} taskTime={taskTime} tz={tz} />}
      {page === 'dashboard' && isAdmin && <Dashboard profiles={profiles} tasks={tasks} taskTime={taskTime} weeklyReports={weeklyReports} mon={mon} w0={w0} w1={w1} />}
      {page === 'role' && <RolePage />}
      {page === 'schedule' && (<>

      <section className="strip">
        <div className={'stat ' + (onDuty ? 'good' : 'bad')}><span className="eyebrow">On duty now</span><span className="v">{onDuty ? name(onDuty.owner) : 'Nobody'}</span></div>
        <div className={'stat ' + (!hasTarget(coverage) ? '' : uncovered ? 'bad' : 'good')}><span className="eyebrow">Not covered this week</span><span className="v">{!hasTarget(coverage) ? 'No target set' : uncovered ? dur(uncovered) : 'Fully covered'}</span></div>
        <div className={'stat ' + (open.length ? 'attn' : 'good')}><span className="eyebrow">Needs cover</span><span className="v">{open.length ? `${open.length} shift${open.length > 1 ? 's' : ''}` : 'None'}</span></div>
      </section>

      {!fixedToSelf && (
        <div className="viewpick">
          <label className="eyebrow" htmlFor="view-pick">View</label>
          <select id="view-pick" value={view} onChange={(e) => setView(e.target.value)}>
            <option value="team">Admin view: everyone's availability</option>
            {rcms.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
          {shown === 'team' && (
            <span className="people">{rcms.map((p) => <span key={p.id} className="person"><span className="dot" style={{ background: personColor(p.username) }} />{p.fullName}</span>)}</span>
          )}
        </div>
      )}

      <div className="legend">
        <span><span className="sw avail-sw" />{shown === 'team' ? 'Availability (thin coloured lanes, one per RCM)' : fixedToSelf ? 'Your availability' : `${profiles[shown]?.fullName ?? ''}'s availability`}</span>
        <span><span className="sw mine" />Shift</span>
        <span><span className="sw open" />Needs cover</span>
        <span><span className="sw uncovered" />Required but not covered</span>
        <span><span className="sw pending-sw" />Request (waiting for approval)</span>
        {ghosts.length > 0 && <span><span className="sw ghost-sw" />Suggested shift (click to assign)</span>}
        {canBook && <span>Drag on the grid (or tap) to book. Click a shift to change it. Each name shows that RCM's own time zone.</span>}
      </div>

      <Grid
        mon={mon} tz={tz} now={now} shifts={shifts} profiles={profiles} me={me} coverage={coverage} canBook={canBook}
        onOpenShift={(s) => setDialog({ kind: 'shift', ctx: { shift: s } })}
        onNewShift={(r) => setDialog({ kind: 'shift', ctx: r })}
        onQuickDelete={quickDelete}
        overlay={overlay}
        ghosts={ghosts}
        onGhost={(g) => setDialog({ kind: 'shift', ctx: { newStart: g.start, newMinutes: Math.round((g.end - g.start) / 60000), owner: g.owner } })}
      />

      <section className="panels">
        {plan && <PlanPanel plan={plan} profiles={profiles} tz={tz} showGhosts={showGhosts} onToggleGhosts={() => setShowGhosts((v) => !v)} onAssign={assign} onAssignAll={assignAll} />}
        <HoursPanel shifts={shifts} reports={reports} availability={availability} profiles={profiles} me={me} from={w0} to={w1} now={now} tz={tz} weeklyReports={weeklyReports}
          onExport={exportCsv} onReport={(s) => setDialog({ kind: 'report', shift: s })} onDeleteReport={(s) => repo.deleteReport(s.id)} />
        {!isRcm && <CoveragePanel coverage={coverage} isAdmin={isAdmin} onEdit={() => setDialog({ kind: 'coverage' })} />}
        {!isRcm && <HistoryPanel log={log} profiles={profiles} tz={tz} shifts={shifts} reports={reports} me={me} now={now} onReport={(s) => setDialog({ kind: 'report', shift: s })} onDelete={isAdmin ? (id) => repo.deleteLog(id) : undefined} />}
      </section>
      </>)}

      {dialog?.kind === 'shift' && me && (
        <ShiftEditor ctx={dialog.ctx} repo={repo} tz={tz} me={me} profiles={profiles} shifts={shifts} reports={reports} availability={availability} coverage={coverage} now={now} onClose={() => setDialog(null)} onReport={(s) => setDialog({ kind: 'report', shift: s })} />
      )}
      {dialog?.kind === 'report' && me && (
        <ReportEditor repo={repo} shift={dialog.shift} report={reports[dialog.shift.id]} tz={tz} me={me} profiles={profiles} tasks={tasks} weeklyReports={weeklyReports} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'availability' && me && (
        <Modal label="Availability" wide onClose={() => setDialog(null)}>
          <AvailabilityForm repo={repo} me={me} owner={dialog.owner} weekDates={weekDates}
            availability={availability[dialog.owner.id] || emptyAvailability(dialog.owner.timezone)}
            title={dialog.owner.id === me.id ? 'My availability' : `${dialog.owner.fullName}'s availability`}
            onDone={() => setDialog(null)} onCancel={() => setDialog(null)} />
        </Modal>
      )}
      {dialog?.kind === 'coverage' && <CoverageEditor repo={repo} coverage={coverage} fallbackTz={tz} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'notifications' && me && (
        <NotificationsModal repo={repo} me={me} profiles={profiles} tz={tz} log={log} requests={requests} seenAt={notificationsSeenAt} weeklyReports={weeklyReports} taskLog={taskLog} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'weekly' && me && (
        <WeeklyReportModal repo={repo} me={me} profiles={profiles} week={weekKey} now={now} shifts={shifts} reports={reports} tasks={tasks} weekly={myWeekly} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'team' && me && <TeamModal repo={repo} me={me} profiles={profiles} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'tz' && (
        <Modal label="Time zone" onClose={() => setDialog(null)}>
          <TimezonePicker current={me?.timezone || tz} onCancel={() => setDialog(null)} onSave={async (z) => { await repo.setMyTimezone(z); setDialog(null); }} />
        </Modal>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && <button className="btn" type="button" onClick={() => { const u = toast.undo!; setToast(null); u().catch(() => setToast({ msg: 'Could not undo. Book the shift again.' })); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}
