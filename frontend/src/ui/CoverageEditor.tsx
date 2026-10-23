import { useMemo, useState } from 'react';
import type { Repo } from '../data/repo';
import { suggestNextSlot, validateCoverage, type Coverage, type CoverageDays, type Slot, type Weekday } from '../lib/coverage';
import { DAYS_LONG, allTimeZones, minLabel } from '../lib/time';
import { errorText } from './errors';
import { Field, Modal } from './Modal';

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Admin editor for required hours. Each day can hold several slots, leaving gaps between them. */
export function CoverageEditor({ repo, coverage, fallbackTz, onClose }: { repo: Repo; coverage: Coverage | null; fallbackTz: string; onClose: () => void }) {
  const zones = useMemo(() => allTimeZones(), []);
  const [tz, setTz] = useState(coverage?.tz || fallbackTz);
  const [days, setDays] = useState<Record<Weekday, Slot[]>>(() =>
    Object.fromEntries(WEEKDAYS.map((d) => [d, (coverage?.days[d] || []).map((s) => ({ ...s }))])) as Record<Weekday, Slot[]>);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (d: Weekday, slots: Slot[]) => setDays((cur) => ({ ...cur, [d]: slots }));
  const setSlot = (d: Weekday, i: number, patch: Partial<Slot>) => update(d, days[d].map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const addSlot = (d: Weekday) => {
    const next = suggestNextSlot(days[d]);
    if (!next) return;
    const sorted = [...days[d]].sort((a, b) => a.start - b.start);
    if (next.shrinkLastTo !== undefined) sorted[sorted.length - 1] = { ...sorted[sorted.length - 1], end: next.shrinkLastTo };
    update(d, [...sorted, { start: next.start, end: next.end }]);
  };
  const copyMonday = () => setDays((cur) => Object.fromEntries(WEEKDAYS.map((d) => [d, cur[1].map((s) => ({ ...s }))])) as Record<Weekday, Slot[]>);

  async function save() {
    const out: CoverageDays = {};
    for (const d of WEEKDAYS) if (days[d].length) out[d] = [...days[d]].sort((a, b) => a.start - b.start);
    const err = validateCoverage(out);
    if (err) { setError(err); return; }
    setBusy(true); setError(null);
    try { await repo.setCoverage(tz, out); onClose(); } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }

  return (
    <Modal label="Required coverage" wide onClose={onClose}>
      <div>
        <div className="eyebrow">Admin</div>
        <h2>Required coverage</h2>
        <p className="note">Hours that must always have one RCM on duty. Add several slots to a day to leave gaps between them. Uncovered hours turn red on the board.</p>
      </div>
      <Field label="Time zone of these hours" htmlFor="cov-tz">
        <select id="cov-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
      </Field>
      <div>
        {WEEKDAYS.map((d) => {
          const dayName = DAYS_LONG[d - 1];
          return (
            <div className="covday" key={d} data-testid={`cov-day-${d}`}>
              <div className="d">{dayName}</div>
              <div className="covslots">
                {days[d].length === 0 && <span className="none">Not required</span>}
                {days[d].map((s, i) => (
                  <div className="covslot" key={i}>
                    <select aria-label={`${dayName} slot ${i + 1} from`} value={s.start} onChange={(e) => setSlot(d, i, { start: +e.target.value })}>
                      {Array.from({ length: 96 }, (_, k) => <option key={k} value={k * 15}>{minLabel(k * 15)}</option>)}
                    </select>
                    <span className="to">to</span>
                    <select aria-label={`${dayName} slot ${i + 1} until`} value={s.end} onChange={(e) => setSlot(d, i, { end: +e.target.value })}>
                      {Array.from({ length: 96 }, (_, k) => <option key={k} value={(k + 1) * 15}>{minLabel((k + 1) * 15)}</option>)}
                    </select>
                    <button type="button" className="btn icon" aria-label="Remove slot" title="Remove slot" onClick={() => update(d, days[d].filter((_, k) => k !== i))}>×</button>
                  </div>
                ))}
                <div className="addrow">
                  <button type="button" className="btn small" aria-label="Add slot" disabled={!suggestNextSlot(days[d])} onClick={() => addSlot(d)}>+ Add slot</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn" type="button" onClick={copyMonday}>Copy Monday to all days</button>
        <span className="spacer" />
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={busy} onClick={save}>Save target</button>
      </div>
    </Modal>
  );
}
