import type { ReactNode } from 'react';
import { suggestNextSlot, type Slot } from '../lib/coverage';
import { minLabel } from '../lib/time';

/** One day's list of time slots, with "+ Add slot" and remove buttons. Used for coverage and availability. */
export function SlotsEditor({ label, slots, onChange, emptyText, testId, extra }: {
  label: string; slots: Slot[]; onChange: (slots: Slot[]) => void; emptyText: string; testId: string; extra?: ReactNode;
}) {
  const set = (i: number, patch: Partial<Slot>) => onChange(slots.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const add = () => {
    const next = suggestNextSlot(slots);
    if (!next) return;
    const sorted = [...slots].sort((a, b) => a.start - b.start);
    if (next.shrinkLastTo !== undefined) sorted[sorted.length - 1] = { ...sorted[sorted.length - 1], end: next.shrinkLastTo };
    onChange([...sorted, { start: next.start, end: next.end }]);
  };
  return (
    <div className="covday" data-testid={testId}>
      <div className="d">{label}{extra}</div>
      <div className="covslots">
        {slots.length === 0 && <span className="none">{emptyText}</span>}
        {slots.map((s, i) => (
          <div className="covslot" key={i}>
            <select aria-label={`${label} slot ${i + 1} from`} value={s.start} onChange={(e) => set(i, { start: +e.target.value })}>
              {Array.from({ length: 96 }, (_, k) => <option key={k} value={k * 15}>{minLabel(k * 15)}</option>)}
            </select>
            <span className="to">to</span>
            <select aria-label={`${label} slot ${i + 1} until`} value={s.end} onChange={(e) => set(i, { end: +e.target.value })}>
              {Array.from({ length: 96 }, (_, k) => <option key={k} value={(k + 1) * 15}>{minLabel((k + 1) * 15)}</option>)}
            </select>
            <button type="button" className="btn icon" aria-label="Remove slot" title="Remove slot" onClick={() => onChange(slots.filter((_, k) => k !== i))}>×</button>
          </div>
        ))}
        <div className="addrow">
          <button type="button" className="btn small" aria-label="Add slot" disabled={!suggestNextSlot(slots)} onClick={add}>+ Add slot</button>
        </div>
      </div>
    </div>
  );
}
