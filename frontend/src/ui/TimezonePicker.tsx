import { useMemo, useState } from 'react';
import { allTimeZones, browserTimeZone, hm, tzLabel } from '../lib/time';
import { errorText } from './errors';
import { Field } from './Modal';

/** The RCM picks their own time zone at first login (and can change it later). */
export function TimezonePicker({ current, onSave, onCancel }: { current: string | null; onSave: (tz: string) => Promise<void>; onCancel?: () => void }) {
  const zones = useMemo(() => allTimeZones(), []);
  const [tz, setTz] = useState(current || browserTimeZone());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  async function save() {
    setBusy(true); setError(null);
    try { await onSave(tz); } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }

  return (
    <>
      <div>
        <div className="eyebrow">{current ? 'Settings' : 'Welcome'}</div>
        <h2>Choose your time zone</h2>
        <p className="note">The board is shown in this time zone, and your colleagues see it next to your name on every shift.</p>
      </div>
      <Field label="Your time zone" htmlFor="tz-select">
        <select id="tz-select" value={tz} onChange={(e) => setTz(e.target.value)}>
          {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
      </Field>
      <p className="note mono">{tzLabel(tz, now)} · it is {hm(now, tz)} there now</p>
      {error && <p className="err">{error}</p>}
      <div className="actions">
        {onCancel && <button className="btn" type="button" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" type="button" disabled={busy} onClick={save}>Save time zone</button>
      </div>
    </>
  );
}
