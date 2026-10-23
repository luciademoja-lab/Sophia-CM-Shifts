import { useMemo, useState } from 'react';
import type { Repo } from '../data/repo';
import { canAskCover, canChange, canReport, findOverlap, type Profile, type Report, type Shift } from '../lib/shifts';
import { dateOf, dateValue, dur, minLabel, minuteOfDay, parseDateValue, rangeLabel, zonedToUtc } from '../lib/time';
import { errorText } from './errors';
import { personName } from './Grid';
import { Field, Modal } from './Modal';
import { reportSummary } from './ReportEditor';
import { emptyAvailability, isAvailable, type Availability } from '../lib/availability';
import { isRequiredRange, type Coverage } from '../lib/coverage';

export type EditorCtx = { shift: Shift } | { newStart: number; newMinutes: number; owner?: string };

type Props = {
  ctx: EditorCtx;
  repo: Repo;
  tz: string;
  me: Profile;
  profiles: Record<string, Profile>;
  shifts: Shift[];
  reports: Record<string, Report>;
  availability: Record<string, Availability>;
  coverage: Coverage | null;
  now: number;
  onClose: () => void;
  onReport: (s: Shift) => void;
};

export function ShiftEditor({ ctx, repo, tz, me, profiles, shifts, reports, availability, coverage, now, onClose, onReport }: Props) {
  const s = 'shift' in ctx ? ctx.shift : null;
  const isNew = !s, isOpen = !!s && s.status === 'open', isPending = !!s && s.status === 'pending';
  const isAdmin = me.role === 'admin';
  const mine = isNew || s!.owner === me.id;
  const isViewer = me.role === 'viewer';
  const reviewing = isPending && isAdmin;
  const editable = !isViewer && !reviewing && (isNew || (!isOpen && canChange(s!, me, now)));
  const pastLocked = !isNew && !isOpen && !isViewer && mine && !isAdmin && !canChange(s!, me, now);
  const start0 = s ? s.start : (ctx as { newStart: number }).newStart;
  const minutes0 = s ? Math.round((s.end - s.start) / 60000) : (ctx as { newMinutes: number }).newMinutes;
  const name = (id: string) => personName(profiles, id, me).replace(' (you)', '');

  const people = useMemo(() => Object.values(profiles).filter((p) => p.active && p.role !== 'viewer').sort((a, b) => a.fullName.localeCompare(b.fullName)), [profiles]);
  const [day, setDay] = useState(dateValue(dateOf(start0, tz)));
  const [startMin, setStartMin] = useState(minuteOfDay(start0, tz));
  const [length, setLength] = useState(minutes0);
  const [owner, setOwner] = useState(s ? (isOpen ? me.id : s.owner) : ((ctx as { owner?: string }).owner ?? me.id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const read = () => {
    const d = parseDateValue(day);
    if (!d) return null;
    const st = zonedToUtc(d, startMin, tz);
    return { start: st, end: st + length * 60000 };
  };
  const r = read();
  const availableFor = (id: string, range: { start: number; end: number } | null) =>
    !!range && isAvailable(availability[id] || emptyAvailability(profiles[id]?.timezone ?? null), range.start, range.end);
  const target = owner;
  const range = isOpen ? s : r;
  const outside = !!range && !availableFor(target, range);
  // RCMs booking outside the required hours or their availability send a request instead.
  const asRequest = me.role === 'rcm' && !isOpen && !!r && (!availableFor(me.id, r) || !isRequiredRange(coverage, r.start, r.end));
  const outsideMsg = target === me.id
    ? 'This is outside your availability.'
    : `Outside ${profiles[target]?.fullName ?? 'this person'}'s availability. You can still assign it.`;
  const dot = (ok: boolean) => (ok ? '🟢' : '🔴');

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); onClose(); } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }
  const checkFree = (range: { start: number; end: number } | null, ignore: string[]) => {
    if (!range) { setError('Pick a valid day.'); return false; }
    const o = findOverlap(shifts, range.start, range.end, ignore);
    if (o) { setError(`This overlaps ${name(o.owner)}'s shift, ${rangeLabel(o.start, o.end, tz)}. Only one RCM per slot.`); return false; }
    return true;
  };

  const eyebrow = isNew ? 'New shift' : isPending ? 'Request' : isOpen ? 'Needs cover' : s!.coversId ? 'Cover shift' : 'Shift';
  const covered = s?.coversId ? shifts.find((x) => x.id === s.coversId) : undefined;
  const lengths = Array.from({ length: 64 }, (_, k) => (k + 1) * 15);
  if (!lengths.includes(length)) lengths.push(length);

  return (
    <Modal label={eyebrow} onClose={onClose}>
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2>{isNew ? 'Book a shift' : personName(profiles, s!.owner, me)}</h2>
        {covered && <p className="note">Covering for {name(covered.owner)}.</p>}
        {isPending && <p className="note" data-testid="pending-note">Waiting for an admin to approve it.</p>}
        {isViewer ? <p className="note">You have read-only access.</p>
          : pastLocked ? <p className="note">This day has passed: only an admin can change this shift now.</p>
          : !editable && !isOpen && <p className="err">Only the person who booked this shift or an admin can change it.</p>}
      </div>

      {(isAdmin && (editable || isOpen)) ? (
        <Field label={isOpen ? 'Who takes this shift' : 'RCM'} htmlFor="f-owner">
          <select id="f-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {people.filter((p) => !isOpen || p.id !== s!.owner).map((p) => <option key={p.id} value={p.id}>{range ? `${dot(availableFor(p.id, range))} ${p.fullName}` : p.fullName}</option>)}
          </select>
        </Field>
      ) : null}

      <div className="fields">
        <Field label="Day" htmlFor="f-day">
          <input id="f-day" type="date" value={day} disabled={!editable} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Starts" htmlFor="f-start">
          <select id="f-start" value={startMin} disabled={!editable} onChange={(e) => setStartMin(+e.target.value)}>
            {Array.from({ length: 96 }, (_, k) => <option key={k} value={k * 15}>{minLabel(k * 15)}</option>)}
          </select>
        </Field>
        <Field label="Length" htmlFor="f-len">
          <select id="f-len" value={length} disabled={!editable} onChange={(e) => setLength(+e.target.value)}>
            {lengths.map((m) => <option key={m} value={m}>{dur(m)}</option>)}
          </select>
        </Field>
      </div>
      <p className="note mono">{r ? `${rangeLabel(r.start, r.end, tz)} · ${tz}` : ''}</p>
      {s && (reports[s.id] || canReport(s, me, now)) && (
        <div className="reportbox">
          <div className="eyebrow">Report</div>
          <p className="note">{reports[s.id] ? reportSummary(reports[s.id], s.end - s.start) : 'No report yet: log the hours you actually worked and what you did.'}</p>
          {canReport(s, me, now) && <div><button className="btn small" type="button" onClick={() => onReport(s)}>{reports[s.id] ? 'Edit report' : 'Add report'}</button></div>}
        </div>
      )}
      {!isViewer && (editable || isOpen) && outside && <p className={isAdmin ? 'warnline' : 'err'} data-testid="availability-warning">{outsideMsg}</p>}
      {asRequest && editable && <p className="warnline" data-testid="request-warning">{outside ? 'Outside your availability' : 'Outside the required hours'}: this will be sent to the admins as a request. You can confirm it and report on it once an admin approves it.</p>}
      {error && <p className="err" role="alert">{error}</p>}

      <div className="actions">
        {isNew && (<>
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="button" disabled={busy} onClick={() => checkFree(r, []) && run(() => repo.bookShift(r!.start, r!.end, owner === me.id ? null : owner))}>{asRequest ? 'Send request' : 'Book shift'}</button>
        </>)}

        {isOpen && !isViewer && (<>
          {(mine || isAdmin) && (<>
            <button className="btn danger" type="button" disabled={busy} onClick={() => (armed ? run(() => repo.deleteShift(s!.id)) : setArmed(true))}>{armed ? 'Click again to delete' : 'Delete shift'}</button>
            <button className="btn warn" type="button" disabled={busy} onClick={() => checkFree(s, [s!.id]) && run(() => repo.cancelAsk(s!.id))}>Withdraw cover request</button>
          </>)}
          <span className="spacer" />
          {!(s!.owner === me.id && !isAdmin) && (
            <button className="btn primary" type="button" disabled={busy || owner === s!.owner} onClick={() => checkFree(s, [s!.id]) && run(() => repo.takeShift(s!.id, owner === me.id ? null : owner))}>{isAdmin && owner !== me.id ? 'Give this shift' : 'Take this shift'}</button>
          )}
        </>)}

        {isPending && isAdmin && (<>
          <button className="btn danger" type="button" disabled={busy} onClick={() => run(() => repo.rejectShift(s!.id))}>Reject</button>
          <span className="spacer" />
          <button className="btn primary" type="button" disabled={busy} onClick={() => run(() => repo.approveShift(s!.id))}>Approve</button>
        </>)}

        {!isNew && !isOpen && !reviewing && editable && (<>
          <button className="btn danger" type="button" disabled={busy} onClick={() => (armed ? run(() => repo.deleteShift(s!.id)) : setArmed(true))}>{armed ? 'Click again to delete' : isPending ? 'Withdraw request' : s!.coversId ? 'Give back' : 'Delete shift'}</button>
          {canAskCover(s!, me, now) && <button className="btn warn" type="button" disabled={busy} onClick={() => run(() => repo.askCover(s!.id))}>Ask for cover</button>}
          <span className="spacer" />
          <button className="btn primary" type="button" disabled={busy} onClick={() => {
            if (!checkFree(r, [s!.id])) return;
            if (r!.start === s!.start && r!.end === s!.end && owner === s!.owner) { onClose(); return; }
            run(() => repo.updateShift(s!.id, r!.start, r!.end, owner === s!.owner ? null : owner));
          }}>{asRequest && !isPending ? 'Send request' : 'Save'}</button>
        </>)}

        {!isNew && (isViewer || (!isOpen && !editable && !reviewing)) && (<>
          <span className="spacer" />
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </>)}
      </div>
    </Modal>
  );
}
