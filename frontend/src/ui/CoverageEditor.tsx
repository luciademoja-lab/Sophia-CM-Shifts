import { useMemo, useState } from 'react';
import type { Repo } from '../data/repo';
import { validateCoverage, type Coverage, type CoverageDays, type Slot, type Weekday } from '../lib/coverage';
import { DAYS_LONG, allTimeZones } from '../lib/time';
import { errorText } from './errors';
import { Field, Modal } from './Modal';
import { SlotsEditor } from './SlotsEditor';

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
        <p className="note">Hours that must always have one SCM on duty. Add several slots to a day to leave gaps between them. Uncovered hours turn red on the board.</p>
      </div>
      <Field label="Time zone of these hours" htmlFor="cov-tz">
        <select id="cov-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
          {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
      </Field>
      <div>
        {WEEKDAYS.map((d) => (
          <SlotsEditor key={d} label={DAYS_LONG[d - 1]} slots={days[d]} onChange={(sl) => update(d, sl)} emptyText="Not required" testId={`cov-day-${d}`} />
        ))}
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
