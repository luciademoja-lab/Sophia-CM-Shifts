import type { Repo } from '../data/repo';
import { HoursChart } from './HoursChart';
import { useState } from 'react';
import type { Profile } from '../lib/shifts';
import { completedCounts, estimateStats, type EstimateLine, type Task, type TaskTimeRow } from '../lib/tasks';
import type { WeeklyReport } from '../lib/work';
import { dur, shortDate, addDays, type PlainDate } from '../lib/time';

type Props = {
  profiles: Record<string, Profile>; tasks: Task[]; taskTime: TaskTimeRow[]; weeklyReports: WeeklyReport[];
  mon: PlainDate; w0: number; w1: number;
  repo: Repo; tz: string; now: number; refreshKey: unknown;
};

const pct = (n: number) => (n > 0 ? `+${n}%` : `${n}%`);

/** Admins: estimated vs logged time on completed tasks, and tasks completed this week. */
export function Dashboard({ profiles, tasks, taskTime, weeklyReports, mon, w0, w1, repo, tz, now, refreshKey }: Props) {
  const [scope, setScope] = useState<'week' | 'all'>('week');
  const rcms = Object.values(profiles).filter((p) => p.active && p.role === 'rcm').sort((a, b) => a.fullName.localeCompare(b.fullName));
  // speed metrics are about SCMs only: tasks completed by admins are left out
  const isRcm = (id: string) => profiles[id]?.role === 'rcm';
  const stats = scope === 'week' ? estimateStats(tasks, taskTime, w0, w1, isRcm) : estimateStats(tasks, taskTime, 0, Number.MAX_SAFE_INTEGER, isRcm);
  const done = completedCounts(tasks, w0, w1);
  const byRcms = Object.entries(done.people).filter(([id]) => isRcm(id)).reduce((m, [, n]) => m + n, 0);
  const byAdmins = Object.entries(done.people).filter(([id]) => profiles[id]?.role === 'admin').reduce((m, [, n]) => m + n, 0);
  const empty: EstimateLine = { tasks: 0, estimate: 0, actual: 0, avgDiffPct: 0 };
  const rows: Array<{ id: string; name: string; line: EstimateLine; team?: boolean }> = [
    { id: 'team', name: 'SCM average', line: stats.team, team: true },
    ...rcms.map((p) => ({ id: p.id, name: p.fullName, line: stats.people[p.id] || empty })),
  ];
  // average hours per completed task, so the team row and each SCM share one scale
  const per = (l: EstimateLine, v: number) => (l.tasks ? v / l.tasks : 0);
  const max = Math.max(1, ...rows.flatMap((r) => [per(r.line, r.line.estimate), per(r.line, r.line.actual)]));
  const maxDone = Math.max(1, ...rcms.map((p) => done.people[p.id] || 0));
  const week = `${shortDate(mon)} – ${shortDate(addDays(mon, 6))}`;
  const weekKey = `${mon.y}-${String(mon.m).padStart(2, '0')}-${String(mon.d).padStart(2, '0')}`;

  return (
    <section className="dashboard viz-root" data-tour="dashboard">
      <HoursChart repo={repo} tz={tz} now={now} refreshKey={refreshKey} />
      <div className="nums">
        <div className="panel stat-tile"><span className="eyebrow">Completed by the whole team</span><b data-testid="done-total">{done.total}</b><span className="sub">{week}</span></div>
        <div className="panel stat-tile"><span className="eyebrow">Completed by SCMs</span><b data-testid="done-rcms">{byRcms}</b><span className="sub">{week}</span></div>
        <div className="panel stat-tile"><span className="eyebrow">Completed by admins</span><b data-testid="done-admins">{byAdmins}</b><span className="sub">{week} · not counted in the speed metrics</span></div>
        <div className="panel stat-tile"><span className="eyebrow">SCMs vs estimate ({scope === 'week' ? 'this week' : 'all time'})</span><b>{stats.team.tasks ? pct(stats.team.avgDiffPct) : '–'}</b><span className="sub">{stats.team.tasks ? `average over ${stats.team.tasks} completed task${stats.team.tasks > 1 ? 's' : ''}` : 'no completed tasks yet'}</span></div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Estimated vs logged time per task</h2>
          <div className="seg" role="group" aria-label="Period">
            <button type="button" aria-pressed={scope === 'week'} onClick={() => setScope('week')}>This week</button>
            <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All time</button>
          </div>
        </div>
        <div className="legend"><span><span className="sw est" />Estimated</span><span><span className="sw act" />Logged in shift reports</span></div>
        <div className="bars" role="table" aria-label="Estimated vs logged time">
          {rows.map((r) => {
            const e = per(r.line, r.line.estimate), a = per(r.line, r.line.actual);
            return (
              <div key={r.id} className={'barrow' + (r.team ? ' team' : '')} role="row">
                <span className="who" role="rowheader">{r.name}</span>
                <span className="pair" role="cell">
                  <span className="bar est" style={{ width: `${(e / max) * 100}%` }} title={`${r.name}: estimated ${dur(Math.round(e))} per task`} />
                  <span className="bar act" style={{ width: `${(a / max) * 100}%` }} title={`${r.name}: logged ${dur(Math.round(a))} per task`} />
                </span>
                <span className="val" role="cell">{r.line.tasks ? `${dur(Math.round(e))} → ${dur(Math.round(a))} · ${pct(r.line.avgDiffPct)}` : 'no completed tasks'}</span>
              </div>
            );
          })}
        </div>
        <p className="note">SCMs only: tasks completed by admins are not counted here. Average time per completed task; logged time comes from the tasks linked in shift reports, and the percentage is the average difference from the estimate (over 0% = took longer).</p>
      </div>

      <div className="panel">
        <h2>Tasks completed by each SCM this week</h2>
        <div className="bars" role="table" aria-label="Tasks completed per SCM">
          {rcms.map((p) => {
            const n = done.people[p.id] || 0;
            return (
              <div key={p.id} className="barrow" role="row">
                <span className="who" role="rowheader">{p.fullName}</span>
                <span className="pair" role="cell"><span className="bar est" style={{ width: `${(n / maxDone) * 100}%` }} title={`${p.fullName}: ${n} completed`} /></span>
                <span className="val" role="cell" data-testid={'done-' + p.username}>{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <h2>Weekly reports, {week}</h2>
        <table>
          <thead><tr><th>SCM</th><th>Status</th><th className="num">Hours</th></tr></thead>
          <tbody>{rcms.map((p) => {
            const w = weeklyReports.find((x) => x.owner === p.id && x.week === weekKey);
            return <tr key={p.id}><td>{p.fullName}</td><td>{w ? { submitted: 'Waiting for approval', approved: 'Approved', rejected: 'Sent back' }[w.status] : 'Not sent'}</td><td className="num">{w ? dur(w.workedMinutes) : '–'}</td></tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
