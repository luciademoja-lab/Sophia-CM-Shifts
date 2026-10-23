import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { uncoveredRuns, type Coverage } from '../lib/coverage';
import { activeShifts, canManage, personColor, type Profile, type Shift } from '../lib/shifts';
import { DAYS, QUARTER, addDays, dateOf, dayStartMs, hm, minLabel, rangeLabel, sameDate, tzLabel, zonedToUtc, type PlainDate } from '../lib/time';

const ROW = 11, SLOTS = 96;

export type NewShiftRequest = { newStart: number; newMinutes: number };

type Props = {
  mon: PlainDate;
  tz: string;
  now: number;
  shifts: Shift[];
  profiles: Record<string, Profile>;
  me: Profile | null;
  coverage: Coverage | null;
  canBook: boolean;
  onOpenShift: (s: Shift) => void;
  onNewShift: (r: NewShiftRequest) => void;
  onQuickDelete: (s: Shift) => void;
};

export function personName(profiles: Record<string, Profile>, id: string, me: Profile | null): string {
  const n = profiles[id]?.fullName || 'Someone';
  return me && id === me.id ? n + ' (you)' : n;
}

export function personTz(profiles: Record<string, Profile>, id: string, at: number): string {
  const tz = profiles[id]?.timezone;
  return tz ? tzLabel(tz, at) : 'time zone not set';
}

export function Grid(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { if (wrap.current) wrap.current.scrollTop = 7 * 4 * ROW; }, []);
  const today = dateOf(p.now, p.tz);
  const act = activeShifts(p.shifts);
  const booked = act.filter((s) => s.status === 'booked');

  return (
    <div className="boardwrap" ref={wrap}>
      <div className="board">
        <div className="corner" />
        {DAYS.map((d, i) => {
          const date = addDays(p.mon, i);
          return (
            <div key={d} className={'dayhead' + (sameDate(date, today) ? ' is-today' : '')}>
              <span className="dname">{d}</span><span className="dnum">{date.d}</span>
            </div>
          );
        })}
        <div className="gutter">
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="hlabel" style={{ top: h * 4 * ROW }}>{minLabel(h * 60)}</div>)}
        </div>
        {DAYS.map((_, i) => <DayColumn key={i} {...p} date={addDays(p.mon, i)} act={act} booked={booked} isToday={sameDate(addDays(p.mon, i), today)} />)}
      </div>
    </div>
  );
}

function DayColumn(p: Props & { date: PlainDate; act: Shift[]; booked: Shift[]; isToday: boolean }) {
  const { date, tz } = p;
  const d0 = dayStartMs(date, tz), dEnd = dayStartMs(addDays(date, 1), tz);
  const runs = uncoveredRuns(date, tz, p.coverage, p.booked);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const lastPointer = useRef('mouse');

  const slotAt = (el: HTMLElement, clientY: number) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(SLOTS - 1, Math.floor((clientY - r.top) / ROW)));
  };
  const isOnShift = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('.shift');

  function down(e: RPointerEvent<HTMLDivElement>) {
    lastPointer.current = e.pointerType || 'mouse';
    if (lastPointer.current !== 'mouse' || e.button !== 0 || !p.canBook || isOnShift(e.target)) return;
    const s = slotAt(e.currentTarget, e.clientY);
    setDrag({ a: s, b: s });
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e: RPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const b = slotAt(e.currentTarget, e.clientY);
    if (b !== drag.b) setDrag({ ...drag, b });
  }
  function up() {
    if (!drag) return;
    const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b) + 1;
    setDrag(null);
    const mins = (b - a) * 15;
    p.onNewShift({ newStart: zonedToUtc(date, a * 15, tz), newMinutes: mins < 30 ? 60 : mins });
  }

  return (
    <div
      className={'col' + (p.canBook ? ' can-book' : '')}
      data-day={p.date.d}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      onClick={(e) => {
        if (lastPointer.current === 'mouse' || !p.canBook || isOnShift(e.target)) return;
        p.onNewShift({ newStart: zonedToUtc(date, slotAt(e.currentTarget, e.clientY) * 15, tz), newMinutes: 60 });
      }}
    >
      {runs.map((r) => (
        <div key={r.from} className="gap" style={{ top: r.from * ROW, height: (r.to - r.from) * ROW }} title={`Not covered ${minLabel(r.from * 15)}–${minLabel(r.to * 15)}`} />
      ))}
      {p.act.filter((s) => s.end > d0 && s.start < dEnd).map((s) => (
        <ShiftBlock key={s.id} {...p} s={s} d0={d0} dEnd={dEnd} />
      ))}
      {p.isToday && <div className="nowline" style={{ top: ((p.now - d0) / QUARTER) * ROW }} />}
      {drag && (() => {
        const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b) + 1;
        return <div className="dragbox" style={{ top: a * ROW, height: (b - a) * ROW }}>{minLabel(a * 15)}–{minLabel(b * 15)}</div>;
      })()}
    </div>
  );
}

function ShiftBlock(p: Props & { s: Shift; d0: number; dEnd: number }) {
  const { s, d0, dEnd, tz } = p;
  const a = Math.max(s.start, d0), b = Math.min(s.end, dEnd);
  const quarters = (b - a) / QUARTER;
  const open = s.status === 'open';
  const name = personName(p.profiles, s.owner, p.me);
  const zone = personTz(p.profiles, s.owner, s.start);
  const color = personColor(p.profiles[s.owner]?.username || s.owner);
  return (
    <div
      className={'shift' + (open ? ' is-open' : '') + (p.me && s.owner === p.me.id ? ' is-mine' : '')}
      role="button"
      tabIndex={0}
      style={{ top: ((a - d0) / QUARTER) * ROW, height: Math.max(quarters * ROW, ROW), ['--pc' as string]: color }}
      aria-label={`${name} (${zone}), ${rangeLabel(s.start, s.end, tz)}${open ? ', needs cover' : ''}`}
      onClick={(e) => { e.stopPropagation(); p.onOpenShift(s); }}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); p.onOpenShift(s); } }}
    >
      <span className="who">{name}</span>
      {quarters >= 2 && <span className="tz">{zone}</span>}
      {quarters >= 3 && <span className="when">{hm(s.start, tz)}–{hm(s.end, tz)}</span>}
      {open && quarters >= 4 && <span className="tag">Needs cover</span>}
      {canManage(s, p.me) && (
        <button
          type="button" className="x" title="Delete shift" aria-label={`Delete ${name}'s shift, ${rangeLabel(s.start, s.end, tz)}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); p.onQuickDelete(s); }}
        >×</button>
      )}
    </div>
  );
}
