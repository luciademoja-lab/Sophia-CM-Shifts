import { useState } from 'react';
import type { Repo } from '../data/repo';
import type { Profile } from '../lib/shifts';
import { isGeneral, repeatLabel, templateConflict, validateTemplate, type RepeatUnit, type TodoTemplate } from '../lib/todos';
import { dateValue, dateOf, minuteOfDay, minLabel, parseDateValue, rangeLabel, zonedToUtc } from '../lib/time';
import { errorText } from './errors';
import { Field, Modal } from './Modal';

// "YYYY-MM-DDTHH:MM" in the admin's time zone <-> instant
const toInput = (ms: number, tz: string) => `${dateValue(dateOf(ms, tz))}T${minLabel(minuteOfDay(ms, tz))}`;
function fromInput(v: string, tz: string): number | null {
  const [d, t] = v.split('T');
  const date = parseDateValue(d);
  const m = /^(\d{2}):(\d{2})$/.exec(t || '');
  return date && m ? zonedToUtc(date, +m[1] * 60 + +m[2], tz) : null;
}

const UNITS: Array<[RepeatUnit, string]> = [['shift', 'Every shift'], ['hours', 'Every x hours'], ['days', 'Every x days'], ['weeks', 'Every x weeks'], ['months', 'Every x months']];

/** Admins: the to-do checklists SCMs see when they start a shift. */
export function TemplatesModal({ repo, profiles, templates, tz, onClose }: { repo: Repo; profiles: Record<string, Profile>; templates: TodoTemplate[]; tz: string; onClose: () => void }) {
  const [editing, setEditing] = useState<TodoTemplate | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const who = (t: TodoTemplate) => (t.everyone ? 'Everyone' : t.people.map((id) => profiles[id]?.fullName || 'Someone').join(', '));
  const fresh = (): TodoTemplate => ({ id: '', title: '', items: [], everyone: true, people: [], repeat: { unit: 'shift', every: 1, from: Date.now() }, slot: null, mode: 'add' });

  if (editing) return <TemplateEditor repo={repo} profiles={profiles} templates={templates} tz={tz} template={editing} onBack={() => setEditing(null)} />;
  return (
    <Modal label="To-do templates" wide onClose={onClose}>
      <div><div className="eyebrow">Tasks</div><h2>To-do templates</h2>
        <p className="note">The checklists SCMs see when they press “Start shift”. A template for every shift is the general one; a specific one (repeating, or for one time slot) adds to it or replaces it.</p></div>
      {!templates.length ? <p className="empty">No templates yet.</p> : (
        <ul className="tpl-list" aria-label="Templates">
          {templates.map((t) => (
            <li key={t.id}>
              <div><b>{t.title}</b> <span className="muted">· {t.items.length} line{t.items.length === 1 ? '' : 's'}</span></div>
              <span className="sub">{repeatLabel(t)}{t.slot ? ` · ${rangeLabel(t.slot.start, t.slot.end, tz)}` : ''} · {who(t)}{isGeneral(t) ? '' : t.mode === 'replace' ? ' · replaces the general list' : ' · adds to the general list'}</span>
              <div className="row">
                <button className="btn small" type="button" onClick={() => setEditing(structuredClone(t))}>Edit</button>
                <button className="btn small danger" type="button" onClick={() => (armed === t.id ? repo.deleteTodoTemplate(t.id).then(() => setArmed(null), (e) => setError(errorText(e, tz))) : setArmed(t.id))}>{armed === t.id ? 'Click again to delete' : 'Delete'}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn primary" type="button" onClick={() => setEditing(fresh())}>New template</button>
        <span className="spacer" />
        <button className="btn" type="button" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function TemplateEditor({ repo, profiles, templates, tz, template, onBack }: { repo: Repo; profiles: Record<string, Profile>; templates: TodoTemplate[]; tz: string; template: TodoTemplate; onBack: () => void }) {
  const people = Object.values(profiles).filter((p) => p.active && p.role === 'rcm').sort((a, b) => a.fullName.localeCompare(b.fullName));
  const [title, setTitle] = useState(template.title);
  const [lines, setLines] = useState(template.items.join('\n'));
  const [everyone, setEveryone] = useState(template.everyone);
  const [chosen, setChosen] = useState<string[]>(template.people);
  const [scheduler, setScheduler] = useState(!!template.repeat);
  const [unit, setUnit] = useState<RepeatUnit>(template.repeat?.unit ?? 'shift');
  const [every, setEvery] = useState(template.repeat?.every ?? 1);
  const [from, setFrom] = useState(toInput(template.repeat?.from ?? Date.now(), tz));
  const [slotStart, setSlotStart] = useState(toInput(template.slot?.start ?? Date.now(), tz));
  const [slotEnd, setSlotEnd] = useState(toInput(template.slot?.end ?? Date.now() + 3_600_000, tz));
  const [mode, setMode] = useState(template.mode);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function build(): TodoTemplate | string {
    const f = fromInput(from, tz), a = fromInput(slotStart, tz), b = fromInput(slotEnd, tz);
    const t: TodoTemplate = {
      id: template.id, title: title.trim(), items: lines.split('\n').map((l) => l.trim()).filter(Boolean), everyone, people: everyone ? [] : chosen,
      repeat: scheduler ? { unit, every: unit === 'shift' ? 1 : every, from: f ?? Date.now() } : null,
      slot: scheduler ? null : a != null && b != null ? { start: a, end: b } : null, mode,
    };
    return validateTemplate(t) || templateConflict(t, templates) || t;
  }
  async function save() {
    const t = build();
    if (typeof t === 'string') { setError(t); return; }
    setBusy(true); setError(null);
    try { await repo.saveTodoTemplate(t); onBack(); } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }
  const general = scheduler && unit === 'shift';

  return (
    <Modal label={template.id ? 'Edit template' : 'New template'} wide onClose={onBack}>
      <div><div className="eyebrow">To-do template</div><h2>{template.id ? 'Edit template' : 'New template'}</h2></div>
      <Field label="Title" htmlFor="tp-title"><input id="tp-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Checklist (one line per to-do)" htmlFor="tp-lines">
        <textarea id="tp-lines" rows={6} value={lines} onChange={(e) => setLines(e.target.value)} placeholder={'Check Zone A, B and C\nAnswer DMs\nDaily accounts check'} />
      </Field>

      <div className="checks" role="group" aria-label="For">
        <span className="eyebrow">For</span>
        <label className="check"><input type="radio" name="tp-who" checked={everyone} onChange={() => setEveryone(true)} />Every SCM</label>
        <label className="check"><input type="radio" name="tp-who" checked={!everyone} onChange={() => setEveryone(false)} />Only some SCMs</label>
        {!everyone && people.map((p) => (
          <label key={p.id} className="check indent"><input type="checkbox" checked={chosen.includes(p.id)} onChange={() => setChosen((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id]))} />{p.fullName}</label>
        ))}
      </div>

      <div className="checks" role="group" aria-label="When">
        <span className="eyebrow">When</span>
        <label className="check"><input type="checkbox" checked={scheduler} onChange={(e) => setScheduler(e.target.checked)} />Scheduler on (repeat)</label>
        {scheduler ? (
          <div className="fields">
            <Field label="Repeat" htmlFor="tp-unit">
              <select id="tp-unit" value={unit} onChange={(e) => setUnit(e.target.value as RepeatUnit)}>{UNITS.map(([u, l]) => <option key={u} value={u}>{l}</option>)}</select>
            </Field>
            {unit !== 'shift' && (<>
              <Field label="Every" htmlFor="tp-every"><input id="tp-every" type="number" min={1} max={365} value={every} onChange={(e) => setEvery(Math.round(+e.target.value))} /></Field>
              <Field label="Starting" htmlFor="tp-from"><input id="tp-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            </>)}
          </div>
        ) : (
          <div className="fields">
            <Field label="From" htmlFor="tp-start"><input id="tp-start" type="datetime-local" value={slotStart} onChange={(e) => setSlotStart(e.target.value)} /></Field>
            <Field label="Until" htmlFor="tp-end"><input id="tp-end" type="datetime-local" value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} /></Field>
          </div>
        )}
        <p className="note">{general ? 'The general checklist: every shift of these SCMs.' : scheduler ? 'Shown in the shifts that include each repetition.' : 'Shown in the shifts that overlap this time slot only.'} Times in {tz}.</p>
      </div>

      {!general && (
        <div className="checks" role="radiogroup" aria-label="With the general checklist">
          <span className="eyebrow">With the general (every shift) checklist</span>
          <label className="check"><input type="radio" name="tp-mode" checked={mode === 'add'} onChange={() => setMode('add')} />Add to it</label>
          <label className="check"><input type="radio" name="tp-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />Replace it</label>
        </div>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        <button className="btn" type="button" onClick={onBack}>Back</button>
        <span className="spacer" />
        <button className="btn primary" type="button" disabled={busy} onClick={save}>Save template</button>
      </div>
    </Modal>
  );
}
