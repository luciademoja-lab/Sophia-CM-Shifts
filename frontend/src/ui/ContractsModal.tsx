import { useState, type ClipboardEvent } from 'react';
import type { Repo } from '../data/repo';
import type { Profile } from '../lib/shifts';
import { PRIORITIES, PRIORITY_LABEL, type Priority } from '../lib/tasks';
import { parseContracts, splitEvenly } from '../lib/contracts';
import { dateOf, dur, shortDate } from '../lib/time';
import { errorText } from './errors';
import { Field, Modal } from './Modal';
import { TaskKind } from './TaskKind';

export const CONTRACT_STEPS = `For each poster in the list:
1. Click the name to open the Upwork contract and its conversation.
2. Copy the email address the poster sent there.
3. Create their profile on the OS with that email.
4. Invite them to Slack (by email only).
Then tick the poster in this task.`;

const isTestLogin = (p: Profile) => /test/i.test(`${p.username} ${p.fullName}`);

/** Admins: paste the morning's Upwork contracts and share them out evenly, one task per RCM. */
export function ContractsModal({ repo, profiles, tz, onClose, onRegular }: { repo: Repo; profiles: Record<string, Profile>; tz: string; onClose: () => void; onRegular?: () => void }) {
  const rcms = Object.values(profiles).filter((p) => p.active && p.role === 'rcm').sort((a, b) => a.fullName.localeCompare(b.fullName));
  const [people, setPeople] = useState<string[]>(rcms.filter((p) => !isTestLogin(p)).map((p) => p.id));
  const [text, setText] = useState('');
  const [html, setHtml] = useState('');
  const [title, setTitle] = useState(`New posters · ${shortDate(dateOf(Date.now(), tz))}`);
  const [description, setDescription] = useState(CONTRACT_STEPS);
  const [priority, setPriority] = useState<Priority>('high');
  const [minutes, setMinutes] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const contracts = parseContracts(html, text);
  const chosen = rcms.filter((p) => people.includes(p.id));
  const parts = splitEvenly(contracts, Math.max(1, chosen.length));

  // Names copied from Upwork carry the contract link: read it from the pasted HTML.
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const h = e.clipboardData.getData('text/html');
    if (h && /<a\s/i.test(h)) { setHtml((prev) => prev + h); }
  }
  async function create() {
    if (!contracts.length) { setError('Paste at least one contract link.'); return; }
    if (!chosen.length) { setError('Pick at least one RCM.'); return; }
    setBusy(true); setError(null);
    try {
      await repo.createContractTasks({ title, description, priority, estimateMinutes: minutes }, minutes, chosen.map((p) => p.id), contracts);
      onClose();
    } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }

  return (
    <Modal label="Hiring and onboarding list" wide onClose={onClose}>
      <div><div className="eyebrow">New task</div><h2>Hiring &amp; onboarding list</h2></div>
      {onRegular && <TaskKind current="contracts" onPick={(k) => { if (k === 'regular') onRegular(); }} />}
      <div className="pastehelp">
        <b>1. Paste the new Upwork contracts below.</b> On Upwork, select the freelancer names (each name links to its contract), copy them (Ctrl+C) and paste here (Ctrl+V).
        Plain lines like “Ana Pop https://www.upwork.com/…” work too.
      </div>
      <Field label="Upwork contracts (paste here)" htmlFor="ct-list">
        <textarea id="ct-list" rows={6} value={text} onPaste={onPaste} onChange={(e) => { setText(e.target.value); if (!e.target.value) setHtml(''); }}
          placeholder={'Paste the Upwork contracts here (Ctrl+V)'} />
      </Field>
      <div className="row">
        <span className="note" data-testid="ct-count">{contracts.length} contract{contracts.length === 1 ? '' : 's'} found</span>
        {(text || html) && <button className="linkbtn" type="button" onClick={() => { setText(''); setHtml(''); }}>Clear</button>}
      </div>

      <div className="checks" role="group" aria-label="Share between">
        <span className="eyebrow">2. Share between (split evenly, in order)</span>
        {rcms.map((p) => {
          const k = chosen.findIndex((c) => c.id === p.id);
          return (
            <label key={p.id} className="check">
              <input type="checkbox" checked={people.includes(p.id)} onChange={() => setPeople((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : rcms.filter((r) => r.id === p.id || l.includes(r.id)).map((r) => r.id)))} />
              {p.fullName}{isTestLogin(p) ? ' (test login)' : ''}
              {k >= 0 && contracts.length > 0 && <span className="muted"> · {parts[k].length} contract{parts[k].length === 1 ? '' : 's'}</span>}
            </label>
          );
        })}
      </div>

      <div className="fields">
        <Field label="Task title" htmlFor="ct-title"><input id="ct-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Priority" htmlFor="ct-prio">
          <select id="ct-prio" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        </Field>
        <Field label="Minutes per contract" htmlFor="ct-min">
          <select id="ct-min" value={minutes} onChange={(e) => setMinutes(+e.target.value)}>{[3, 5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
        </Field>
      </div>
      <Field label="Instructions" htmlFor="ct-desc"><textarea id="ct-desc" rows={6} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} /></Field>
      {contracts.length > 0 && chosen.length > 0 && (
        <p className="note">Estimated time: about {dur(Math.ceil(contracts.length / chosen.length) * minutes)} each.</p>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        <span className="spacer" />
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={busy} onClick={create}>Create {Math.min(chosen.length, contracts.length) || ''} task{Math.min(chosen.length, contracts.length) === 1 ? '' : 's'}</button>
      </div>
    </Modal>
  );
}
