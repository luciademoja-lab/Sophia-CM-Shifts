import { useState } from 'react';
import type { Repo } from '../data/repo';
import { daySlots, type Availability } from '../lib/availability';
import { coverageText, validateCoverage, validateDaySlots, type CoverageDays, type Slot, type Weekday } from '../lib/coverage';
import type { Profile } from '../lib/shifts';
import { DAYS, DAYS_LONG, dateValue, shortDate, type PlainDate } from '../lib/time';
import { errorText } from './errors';
import { SlotsEditor } from './SlotsEditor';

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

type Props = {
  repo: Repo;
  me: Profile;
  owner: Profile;
  availability: Availability;
  /** the 7 dates of the week shown on the board, for one-off changes */
  weekDates: PlainDate[];
  title: string;
  intro?: string;
  onDone: () => void;
  onSkip?: () => void;
  onCancel?: () => void;
};

/** Usual week + one-off changes for the week on screen. Times are in the owner's time zone. */
export function AvailabilityForm({ repo, me, owner, availability, weekDates, title, intro, onDone, onSkip, onCancel }: Props) {
  const [week, setWeek] = useState<Record<Weekday, Slot[]>>(() =>
    Object.fromEntries(WEEKDAYS.map((d) => [d, (availability.week[d] || []).map((s) => ({ ...s }))])) as Record<Weekday, Slot[]>);
  const original = Object.fromEntries(weekDates.map((d) => [dateValue(d), availability.days[dateValue(d)] ?? null])) as Record<string, Slot[] | null>;
  const [days, setDays] = useState<Record<string, Slot[] | null>>(() => structuredClone(original));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = owner.id === me.id;
  const tz = owner.timezone || 'UTC';
  const usual = (date: PlainDate) => daySlots({ ...availability, week, days: {} }, date).slots;

  async function save() {
    const out: CoverageDays = {};
    for (const d of WEEKDAYS) if (week[d].length) out[d] = [...week[d]].sort((a, b) => a.start - b.start);
    const err = validateCoverage(out);
    if (err) { setError(err); return; }
    for (const d of weekDates) {
      const v = days[dateValue(d)];
      const e = v ? validateDaySlots(v) : null;
      if (e) { setError(`${DAYS_LONG[(weekdayIndex(d))]} ${shortDate(d)}: ${e}`); return; }
    }
    setBusy(true); setError(null);
    try {
      await repo.setAvailability(out, mine ? null : owner.id);
      for (const d of weekDates) {
        const key = dateValue(d);
        if (JSON.stringify(days[key]) !== JSON.stringify(original[key])) await repo.setAvailabilityDay(key, days[key], mine ? null : owner.id);
      }
      onDone();
    } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }

  return (
    <>
      <div>
        <div className="eyebrow">Availability</div>
        <h2>{title}</h2>
        <p className="note">{intro || 'When you can work. Admins assign shifts inside these hours, and you can only book inside them.'} Times in {tz}.</p>
      </div>

      <div>
        <div className="eyebrow">Usual week</div>
        {WEEKDAYS.map((d) => (
          <SlotsEditor key={d} label={DAYS_LONG[d - 1]} slots={week[d]} emptyText="Not available"
            testId={`av-day-${d}`} onChange={(sl) => setWeek((cur) => ({ ...cur, [d]: sl }))} />
        ))}
        <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
          <button className="btn small" type="button" onClick={() => setWeek((cur) => Object.fromEntries(WEEKDAYS.map((d) => [d, cur[1].map((s) => ({ ...s }))])) as Record<Weekday, Slot[]>)}>Copy Monday to all days</button>
        </div>
      </div>

      <div>
        <div className="eyebrow">This week only ({shortDate(weekDates[0])} – {shortDate(weekDates[6])})</div>
        <p className="note">Tick a day to change it just for that date, for example a day off.</p>
        {weekDates.map((date) => {
          const key = dateValue(date), label = `${DAYS[weekdayIndex(date)]} ${shortDate(date)}`;
          const v = days[key];
          const toggle = (
            <label className="daytoggle">
              <input type="checkbox" checked={v !== null} aria-label={`Different on ${label}`}
                onChange={(e) => setDays((cur) => ({ ...cur, [key]: e.target.checked ? usual(date).map((s) => ({ ...s })) : null }))} />
              <span>different</span>
            </label>
          );
          return v === null ? (
            <div className="covday" key={key} data-testid={`av-date-${key}`}>
              <div className="d">{label}{toggle}</div>
              <div className="none">{coverageText(usual(date)).replace('Not required', 'Not available')} <span className="muted">(usual)</span></div>
            </div>
          ) : (
            <SlotsEditor key={key} label={label} slots={v} emptyText="Not available this day" testId={`av-date-${key}`} extra={toggle}
              onChange={(sl) => setDays((cur) => ({ ...cur, [key]: sl }))} />
          );
        })}
      </div>

      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        {onSkip && <button className="btn" type="button" onClick={onSkip}>Skip for now</button>}
        <span className="spacer" />
        {onCancel && <button className="btn" type="button" onClick={onCancel}>Cancel</button>}
        <button className="btn primary" type="button" disabled={busy} onClick={save}>Save availability</button>
      </div>
    </>
  );
}

function weekdayIndex(d: PlainDate): number {
  const w = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
  return (w + 6) % 7;
}
