import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { uncoveredRuns, type Coverage, type Interval } from '../lib/coverage';
import { teamColors } from '../lib/team';
import { activeShifts, canChange, type Profile, type Shift } from '../lib/shifts';
import { DAYS, addDays, dayHours, minuteOfDay, wallSpan, dateOf, dayStartMs, hm, minLabel, rangeLabel, sameDate, tzLabel, zonedToUtc, type PlainDate } from '../lib/time';

const ROW = 22, SLOTS = 96;

export type NewShiftRequest = { newStart: number; newMinutes: number };

/** Availability drawn behind the shifts: one person's band, or a thin lane per RCM (admin view). */
export type Overlay = { mode: 'single' | 'lanes'; people: Array<{ id: string; name: string; color: string; intervals: Interval[] }> };
const LANE = 6;

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
  overlay: Overlay;
  /** admin view: suggested shifts drawn as dashed ghosts, click to prefill the editor */
  ghosts?: Array<{ owner: string; start: number; end: number }>;
  onGhost?: (g: { owner: string; start: number; end: number }) => void;
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
    <div className="boardwrap" ref={wrap} data-tour="grid">
      <div className="board">
        <div className="corner" />
        {DAYS.map((d, i) => {
          const date = addDays(p.mon, i);
          return (
            <div key={d} className={'dayhead' + (sameDate(date, today) ? ' is-today' : '')}>
              <span className="dname">{d}</span><span className="dnum">{date.d}</span>
              {dayHours(date, p.tz) !== 24 && <span className="dst" title={`Clocks change in ${p.tz} today: this day has ${dayHours(date, p.tz)} hours`}>{dayHours(date, p.tz) > 24 ? 'clocks −1h' : 'clocks +1h'}</span>}
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
  const isOnShift = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('.shift, .ghost');

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
      {p.overlay.people.map((person, i) => person.intervals.filter((iv) => iv.end > d0 && iv.start < dEnd).map((iv) => {
        const w = wallSpan(iv.start, iv.end, d0, dEnd, tz);
        const style = { top: (w.from / 15) * ROW, height: ((w.to - w.from) / 15) * ROW, ['--pc' as string]: person.color };
        return p.overlay.mode === 'single'
          ? <div key={person.id + iv.start} className="avail" style={style} title={`${person.name} available ${hm(iv.start, tz)}–${hm(iv.end, tz)}`} />
          : <div key={person.id + iv.start} className="lane" style={{ ...style, left: 1 + i * LANE }} title={`${person.name} available ${hm(iv.start, tz)}–${hm(iv.end, tz)}`} />;
      }))}
      {runs.map((r) => (
        <div key={r.from} className="gap" style={{ top: r.from * ROW, height: (r.to - r.from) * ROW }} title={`Not covered ${minLabel(r.from * 15)}–${minLabel(r.to * 15)}`} />
      ))}
      {p.act.filter((s) => s.end > d0 && s.start < dEnd).map((s) => (
        <ShiftBlock key={s.id} {...p} s={s} d0={d0} dEnd={dEnd} />
      ))}
      {(p.ghosts || []).filter((g) => g.end > d0 && g.start < dEnd).map((g) => {
        const w = wallSpan(g.start, g.end, d0, dEnd, tz);
        const n = p.profiles[g.owner]?.fullName || 'Someone';
        return (
          <button key={'g' + g.owner + g.start} type="button" className="ghost"
            style={{ top: (w.from / 15) * ROW, height: Math.max(((w.to - w.from) / 15) * ROW, ROW), ['--pc' as string]: teamColors(p.profiles)[g.owner] || '#6B7280', ...(p.overlay.mode === 'lanes' && p.overlay.people.length ? { left: 3 + p.overlay.people.length * LANE } : {}) }}
            aria-label={`Suggested: ${n}, ${rangeLabel(g.start, g.end, tz)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); p.onGhost?.(g); }}
          ><span className="who">{n.split(' ')[0]}?</span></button>
        );
      })}
      {p.isToday && <div className="nowline" style={{ top: (minuteOfDay(p.now, tz) / 15) * ROW }} />}
      {drag && (() => {
        const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b) + 1;
        return <div className="dragbox" style={{ top: a * ROW, height: (b - a) * ROW }}>{minLabel(a * 15)}–{minLabel(b * 15)}</div>;
      })()}
    </div>
  );
}

function ShiftBlock(p: Props & { s: Shift; d0: number; dEnd: number }) {
  const { s, d0, dEnd, tz } = p;
  const w = wallSpan(s.start, s.end, d0, dEnd, tz);
  const quarters = (w.to - w.from) / 15;
  const open = s.status === 'open', pending = s.status === 'pending';
  const name = personName(p.profiles, s.owner, p.me);
  const zone = personTz(p.profiles, s.owner, s.start);
  const color = teamColors(p.profiles)[s.owner] || '#6B7280';
  return (
    <div
      className={'shift' + (open ? ' is-open' : '') + (pending ? ' is-pending' : '') + (p.me && s.owner === p.me.id ? ' is-mine' : '')}
      role="button"
      tabIndex={0}
      style={{
        top: (w.from / 15) * ROW, height: Math.max(quarters * ROW, ROW), ['--pc' as string]: color,
        ...(p.overlay.mode === 'lanes' && p.overlay.people.length ? { left: 3 + p.overlay.people.length * LANE } : {}),
      }}
      aria-label={`${name} (${zone}), ${rangeLabel(s.start, s.end, tz)}${open ? ', needs cover' : ''}${pending ? ', request waiting for approval' : ''}`}
      onClick={(e) => { e.stopPropagation(); p.onOpenShift(s); }}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); p.onOpenShift(s); } }}
    >
      <span className="who">{name}</span>
      {quarters >= 2 && <span className="when">{hm(s.start, tz)}–{hm(s.end, tz)}</span>}
      {open && quarters >= 4 && <span className="tag">Needs cover</span>}
      {pending && quarters >= 4 && <span className="tag">Request</span>}
      {canChange(s, p.me, p.now) && !open && (
        <button
          type="button" className="x" title="Delete shift" aria-label={`Delete ${name}'s shift, ${rangeLabel(s.start, s.end, tz)}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); p.onQuickDelete(s); }}
        >×</button>
      )}
    </div>
  );
}
