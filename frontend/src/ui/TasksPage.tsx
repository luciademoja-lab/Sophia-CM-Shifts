import { useState, type DragEvent } from 'react';
import type { Repo } from '../data/repo';
import type { Profile } from '../lib/shifts';
import {
  PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, actualMinutes, canMove, column, pageOf, taskCards, validateTask,
  type Card, type GrabsFor, type Priority, type Task, type TaskStatus, type TaskTimeRow,
} from '../lib/tasks';
import { dur, shortDate, dateOf } from '../lib/time';
import { errorText } from './errors';
import { Field, Modal } from './Modal';
import { ContractsModal } from './ContractsModal';
import { TaskKind } from './TaskKind';

type Props = { repo: Repo; me: Profile; profiles: Record<string, Profile>; tasks: Task[]; taskTime: TaskTimeRow[]; tz: string };

const COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'done'];

/** RCMs: their tasks plus the ones up for grabs. Admins: every task, create and assign. */
export function TasksPage({ repo, me, profiles, tasks, taskTime, tz }: Props) {
  const isAdmin = me.role === 'admin';
  const [person, setPerson] = useState('');
  const [donePage, setDonePage] = useState(0);
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const people = Object.values(profiles).filter((p) => p.active && p.role !== 'viewer').sort((a, b) => a.fullName.localeCompare(b.fullName));
  const cards = taskCards(tasks, me, isAdmin && person ? person : null);
  const name = (id: string | null) => (id && profiles[id]?.fullName) || 'Someone';

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); } catch (e) { setError(errorText(e, tz)); }
  }
  const move = (c: Card, status: TaskStatus) => { if (c.status !== status) act(() => repo.moveTask(c.task.id, c.person === me.id ? null : c.person, status)); };

  function onDrop(e: DragEvent, status: TaskStatus) {
    e.preventDefault(); setOver(null);
    const [id, who] = (e.dataTransfer.getData('text/plain') || '').split('|');
    const c = cards.find((x) => x.task.id === id && (x.person || '') === who);
    if (c && canMove(c, me)) move(c, status);
  }

  const cardView = (c: Card) => {
    const movable = canMove(c, me);
    const spent = c.person ? actualMinutes(taskTime, c.task.id, c.person) : 0;
    return (
      <li key={c.task.id + (c.person || '')} className={`task prio-${c.task.priority}`} draggable={movable}
        data-testid="task-card"
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', `${c.task.id}|${c.person || ''}`); e.dataTransfer.effectAllowed = 'move'; }}>
        <div className="row">
          <span className={'prio ' + c.task.priority}>{PRIORITY_LABEL[c.task.priority]}</span>
          <button type="button" className="linkbtn tasktitle" onClick={() => setEditing(c.task)}>{c.task.title}</button>
        </div>
        {(isAdmin || c.task.assignees.length > 1) && c.person && <span className="sub">{name(c.person)}</span>}
        {c.task.items.length > 0 && (
          <span className="sub progress" data-testid="task-progress">
            <span className="pbar"><span style={{ width: `${(c.task.items.filter((i) => i.doneAt).length / c.task.items.length) * 100}%` }} /></span>
            {c.task.items.filter((i) => i.doneAt).length}/{c.task.items.length} contracts
          </span>
        )}
        <span className="sub">Est. {dur(c.task.estimateMinutes)}{c.person ? ` · logged ${spent ? dur(spent) : '0m'}` : ''}{c.status === 'done' && c.doneAt ? ` · done ${shortDate(dateOf(c.doneAt, tz))}` : ''}</span>
        {c.status === 'grabs' ? (<>
          {isAdmin && <span className={'pill for-' + c.task.grabsFor}>{c.task.grabsFor === 'admin' ? 'For admins' : 'For RCMs'}</span>}
          {(me.role === 'rcm') === (c.task.grabsFor === 'rcm') && <button className="btn small primary" type="button" onClick={() => act(() => repo.claimTask(c.task.id))}>Take it</button>}
        </>) : movable && (
          <label className="movesel">
            <select aria-label={`Move ${c.task.title}${isAdmin ? ' for ' + name(c.person) : ''}`} value={c.status} onChange={(e) => move(c, e.target.value as TaskStatus)}>
              {COLUMNS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
        )}
      </li>
    );
  };

  return (
    <section className="taskspage">
      <div className="panel-head">
        <h2>{isAdmin ? 'Tasks' : 'My tasks'}</h2>
        <div className="row">
          {isAdmin && (<>
            <label className="eyebrow" htmlFor="task-person">Show</label>
            <select id="task-person" value={person} onChange={(e) => { setPerson(e.target.value); setDonePage(0); }}>
              <option value="">Everyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
            <button className="btn" type="button" onClick={() => setSharing(true)}>Hiring &amp; onboarding list</button>
            <button className="btn primary" type="button" data-tour="newtask" onClick={() => setEditing('new')}>New task</button>
          </>)}
        </div>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="kanban" data-tour="kanban">
        <div className="kcol grabs" data-status="grabs">
          <h3>Up for grabs <span className="muted">{column(cards, 'grabs').length}</span></h3>
          <p className="note">{me.role === 'rcm' ? 'Nobody has these yet: take one and it moves to your To do.' : 'Nobody assigned yet. RCMs take the RCM ones, admins the admin ones.'}</p>
          <ul className="tasklist" aria-label="Up for grabs">
            {column(cards, 'grabs').length ? column(cards, 'grabs').map(cardView) : <li className="empty">Nothing here.</li>}
          </ul>
        </div>
        {COLUMNS.map((status) => {
          const list = column(cards, status);
          const shown = status === 'done' ? pageOf(list, donePage) : { items: list, pages: 1 };
          return (
            <div key={status} className={'kcol' + (over === status ? ' over' : '')} data-status={status}
              onDragOver={(e) => { e.preventDefault(); setOver(status); }} onDragLeave={() => setOver(null)} onDrop={(e) => onDrop(e, status)}>
              <h3>{STATUS_LABEL[status]} <span className="muted">{list.length}</span></h3>
              <ul className="tasklist" aria-label={STATUS_LABEL[status]}>
                {shown.items.length ? shown.items.map(cardView) : <li className="empty">Nothing here.</li>}
              </ul>
              {status === 'done' && shown.pages > 1 && (
                <div className="tabs" role="tablist" aria-label="Done pages">
                  {Array.from({ length: shown.pages }, (_, i) => (
                    <button key={i} type="button" role="tab" aria-selected={i === Math.min(donePage, shown.pages - 1)} className="tab" onClick={() => setDonePage(i)}>
                      {i === 0 ? 'Latest 10' : `${i * 10 + 1}–${Math.min(list.length, i * 10 + 10)}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {sharing && <ContractsModal repo={repo} profiles={profiles} tz={tz} onClose={() => setSharing(false)} onRegular={() => { setSharing(false); setEditing('new'); }} />}
      {editing && (
        <TaskModal repo={repo} me={me} people={people} task={editing === 'new' ? null : tasks.find((t) => t.id === editing.id) || editing}
          onContracts={() => { setEditing(null); setSharing(true); }} profiles={profiles} taskTime={taskTime} tz={tz} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

function TaskModal({ repo, me, people, task, profiles, taskTime, tz, onClose, onContracts }: {
  repo: Repo; me: Profile; people: Profile[]; task: Task | null; profiles: Record<string, Profile>; taskTime: TaskTimeRow[]; tz: string; onClose: () => void;
  onContracts?: () => void;
}) {
  const isAdmin = me.role === 'admin';
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [priority, setPriority] = useState<Priority>(task?.priority || 'normal');
  const est = task?.estimateMinutes ?? 60;
  const [eh, setEh] = useState(Math.floor(est / 60));
  const [em, setEm] = useState(est % 60);
  const [assigned, setAssigned] = useState<string[]>(task?.assignees.map((a) => a.person) || []);
  // asked every time a task is saved without assignees: up for grabs for RCMs or for admins?
  const [grabsFor, setGrabsFor] = useState<GrabsFor | null>(task && !task.assignees.length ? task.grabsFor : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); onClose(); } catch (e) { setError(errorText(e, tz)); setBusy(false); }
  }
  function save() {
    const input = { title, description, priority, estimateMinutes: eh * 60 + em, grabsFor: assigned.length ? null : grabsFor };
    const err = validateTask(input, assigned);
    if (err) { setError(err); return; }
    run(() => (task ? repo.updateTask(task.id, input, assigned) : repo.createTask(input, assigned)));
  }

  if (!isAdmin && task) {
    return (
      <Modal label="Task" onClose={onClose}>
        <div><div className="eyebrow">{PRIORITY_LABEL[task.priority]} priority</div><h2>{task.title}</h2></div>
        {task.description && <p className="prewrap">{task.description}</p>}
        <Checklist repo={repo} task={task} canTick tz={tz} />
        <p className="note">Estimated {dur(task.estimateMinutes)} · you logged {dur(actualMinutes(taskTime, task.id, me.id))}. Link this task in your shift reports to log time on it.</p>
        <div className="actions"><span className="spacer" /><button className="btn" type="button" onClick={onClose}>Close</button></div>
      </Modal>
    );
  }
  return (
    <Modal label={task ? 'Edit task' : 'New task'} onClose={onClose}>
      <div><div className="eyebrow">{task ? 'Edit task' : 'New task'}</div><h2>{task ? task.title : 'Create a task'}</h2></div>
      {!task && onContracts && <TaskKind current="regular" onPick={(k) => { if (k === 'contracts') onContracts(); }} />}
      <Field label="Title" htmlFor="tk-title"><input id="tk-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Description" htmlFor="tk-desc"><textarea id="tk-desc" rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="fields">
        <Field label="Priority" htmlFor="tk-prio">
          <select id="tk-prio" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Estimated hours" htmlFor="tk-eh">
          <select id="tk-eh" value={eh} onChange={(e) => setEh(+e.target.value)}>{Array.from({ length: 41 }, (_, h) => <option key={h} value={h}>{h} h</option>)}</select>
        </Field>
        <Field label="Estimated minutes" htmlFor="tk-em">
          <select id="tk-em" value={em} onChange={(e) => setEm(+e.target.value)}>{[0, 15, 30, 45].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
        </Field>
      </div>
      <p className="note">The estimate is per person: everyone assigned is expected to spend about this long.</p>
      <div className="checks" role="group" aria-label="Assigned to">
        <span className="eyebrow">Assigned to (leave empty to put it up for grabs)</span>
        {people.map((p) => (
          <label key={p.id} className="check">
            <input type="checkbox" checked={assigned.includes(p.id)} onChange={() => setAssigned((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id]))} />
            {p.fullName}{p.role === 'admin' ? ' (admin: only admins will see it)' : ''}
          </label>
        ))}
      </div>
      {!assigned.length && (
        <div className="checks grabsask" role="radiogroup" aria-label="Up for grabs for">
          <span className="eyebrow">Nobody assigned: who can take it? (required)</span>
          <label className="check"><input type="radio" name="tk-grabs" checked={grabsFor === 'rcm'} onChange={() => setGrabsFor('rcm')} />RCMs (shown in the RCMs' Up for grabs)</label>
          <label className="check"><input type="radio" name="tk-grabs" checked={grabsFor === 'admin'} onChange={() => setGrabsFor('admin')} />Admins (only admins see it)</label>
        </div>
      )}
      {task && task.items.length > 0 && <Checklist repo={repo} task={task} canTick tz={tz} />}
      {task && task.assignees.length > 0 && (
        <table className="mini">
          <thead><tr><th>Person</th><th>Status</th><th className="num">Logged</th></tr></thead>
          <tbody>{task.assignees.map((a) => (
            <tr key={a.person}><td>{profiles[a.person]?.fullName || 'Someone'}</td><td>{STATUS_LABEL[a.status]}</td><td className="num">{dur(actualMinutes(taskTime, task.id, a.person))}</td></tr>
          ))}</tbody>
        </table>
      )}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="actions">
        {task && <button className="btn danger" type="button" disabled={busy} onClick={() => (armed ? run(() => repo.deleteTask(task.id)) : setArmed(true))}>{armed ? 'Click again to delete' : 'Delete task'}</button>}
        <span className="spacer" />
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={busy} onClick={save}>{task ? 'Save task' : 'Create task'}</button>
      </div>
    </Modal>
  );
}

/** One line per contract: the name opens the contract on Upwork; tick it once done. */
function Checklist({ repo, task, canTick, tz }: { repo: Repo; task: Task; canTick: boolean; tz: string }) {
  const [error, setError] = useState<string | null>(null);
  if (!task.items.length) return null;
  const done = task.items.filter((i) => i.doneAt).length;
  return (
    <div className="checklist">
      <span className="eyebrow">Contracts · {done}/{task.items.length} done</span>
      <ul aria-label="Contracts">
        {task.items.map((i) => (
          <li key={i.id} className={i.doneAt ? 'done' : ''}>
            <input type="checkbox" aria-label={`Done: ${i.label}`} checked={!!i.doneAt} disabled={!canTick}
              onChange={(e) => repo.toggleTaskItem(i.id, e.target.checked).catch((err) => setError(errorText(err, tz)))} />
            <a href={i.url} target="_blank" rel="noopener noreferrer">{i.label}</a>
          </li>
        ))}
      </ul>
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

