import { useEffect, useRef, useState } from 'react';
import type { Repo } from '../data/repo';
import { lastWeeks, PERIODS, weeklyHistory, type HistoryPoint, type PeriodKey } from '../lib/history';
import { parseDateValue, shortDate } from '../lib/time';

// light: red and green; dark: metallic purple and gold (set in styles.css)
const RED = 'var(--chart-required)', GREEN = 'var(--chart-worked)';
const PAD = { top: 16, right: 16, bottom: 34, left: 44 };
const HEIGHT = 280;

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

/** Admins: hours we required each week (red) against hours worked (green). */
export function HoursChart({ repo, tz, now, refreshKey }: { repo: Repo; tz: string; now: number; refreshKey: unknown }) {
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [points, setPoints] = useState<HistoryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [width, setWidth] = useState(800);
  const box = useRef<HTMLDivElement>(null);
  const weeksN = PERIODS.find((p) => p.key === period)!.weeks;

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    const weeks = lastWeeks(now, tz, weeksN);
    repo.loadHoursHistory(weeks[0].start, weeks[weeks.length - 1].end).then(
      (h) => { if (alive) { setPoints(weeklyHistory(weeks, h.versions, h.worked)); setError(null); } },
      () => { if (alive) setError('Could not load the hours history.'); },
    );
    return () => { alive = false; };
    // reload when the week changes or the data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, tz, weeksN, Math.floor(now / 3_600_000), refreshKey]);

  const data = points ?? [];
  const totalReq = data.reduce((m, p) => m + p.requiredHours, 0);
  const totalWorked = data.reduce((m, p) => m + p.workedHours, 0);
  const max = niceMax(Math.max(1, ...data.flatMap((p) => [p.requiredHours, p.workedHours])));
  const innerW = width - PAD.left - PAD.right, innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const path = (key: 'requiredHours' | 'workedHours') => data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const labelEvery = data.length > 26 ? 4 : data.length > 8 ? 2 : 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const weekDate = (w: string) => shortDate(parseDateValue(w)!);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="panel" data-testid="hours-chart">
      <div className="panel-head">
        <h2>Required vs worked hours</h2>
        <div className="row">
          <div className="seg" role="group" aria-label="Period">
            {PERIODS.map((p) => <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
          </div>
          <button type="button" className="linkbtn" onClick={() => setAsTable((v) => !v)}>{asTable ? 'Show chart' : 'Show table'}</button>
        </div>
      </div>
      <div className="legend">
        <span><span className="sw" style={{ background: RED }} />Required (the target in force that week)</span>
        <span><span className="sw" style={{ background: GREEN }} />Worked (shift reports, or clocked time without a report)</span>
      </div>
      {points && (
        <p className="note" data-testid="hours-summary">
          {PERIODS.find((p) => p.key === period)!.label}: <b>{totalWorked}h</b> worked of <b>{totalReq}h</b> required
          {totalReq ? <> · <b>{Math.round((totalWorked / totalReq) * 100)}%</b></> : null}
        </p>
      )}
      {error && <p className="err">{error}</p>}
      {asTable ? (
        <table>
          <thead><tr><th>Week</th><th>From</th><th className="num">Required</th><th className="num">Worked</th><th className="num">%</th></tr></thead>
          <tbody>{data.map((p) => (
            <tr key={p.week}><td>{p.label}</td><td>{weekDate(p.week)}</td><td className="num">{p.requiredHours}h</td><td className="num">{p.workedHours}h</td>
              <td className="num">{p.requiredHours ? `${Math.round((p.workedHours / p.requiredHours) * 100)}%` : '–'}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="chartbox" ref={box}>
          <svg width={width} height={HEIGHT} role="img" aria-label="Line chart of required and worked hours per week" onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="axis">{Math.round(t)}h</text>
              </g>
            ))}
            {data.map((p, i) => (i % labelEvery === 0 || i === data.length - 1) && (
              <text key={p.week} x={x(i)} y={HEIGHT - 10} textAnchor="middle" className="axis">{p.label}</text>
            ))}
            {h && <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={PAD.top + innerH} className="cross" />}
            <path d={path('requiredHours')} fill="none" style={{ stroke: RED }} strokeWidth={2} strokeLinejoin="round" />
            <path d={path('workedHours')} fill="none" style={{ stroke: GREEN }} strokeWidth={2} strokeLinejoin="round" />
            {data.length <= 26 && data.map((p, i) => (
              <g key={'m' + p.week}>
                <circle cx={x(i)} cy={y(p.requiredHours)} r={4} style={{ fill: RED, stroke: 'var(--surface)' }} strokeWidth={2} />
                <circle cx={x(i)} cy={y(p.workedHours)} r={4} style={{ fill: GREEN, stroke: 'var(--surface)' }} strokeWidth={2} />
              </g>
            ))}
            {data.map((p, i) => {
              const half = data.length <= 1 ? innerW / 2 : innerW / (data.length - 1) / 2;
              return <rect key={'h' + p.week} x={x(i) - half} y={PAD.top} width={half * 2} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />;
            })}
          </svg>
          {h && (
            <div className="charttip" style={{ left: Math.min(width - 190, Math.max(0, x(hover!) + 10)), top: PAD.top }}>
              <b>{h.label}</b> · from {weekDate(h.week)}<br />
              <span style={{ color: RED }}>●</span> Required {h.requiredHours}h<br />
              <span style={{ color: GREEN }}>●</span> Worked {h.workedHours}h
              {h.requiredHours ? <> · {Math.round((h.workedHours / h.requiredHours) * 100)}%</> : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
