// Tasks: admins create and assign them, each assignee moves their own card through
// to do → in progress → done. Tasks nobody is assigned to are "up for grabs".
import type { Profile, Report } from './shifts';

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

export const STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

export type Assignment = { person: string; status: TaskStatus; doneAt: number | null; updatedAt: number };
export type Task = {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  /** estimated time for each assignee */
  estimateMinutes: number;
  /** who can take it while nobody is assigned */
  grabsFor: GrabsFor;
  createdBy: string | null;
  createdAt: number;
  assignees: Assignment[];
  /** checklist lines (e.g. one Upwork contract each), in order */
  items: TaskItem[];
};
export type TaskItem = { id: string; label: string; url: string; doneAt: number | null; doneBy: string | null };
export type GrabsFor = 'rcm' | 'admin';
export type TaskInput = { title: string; description: string; priority: Priority; estimateMinutes: number; grabsFor?: GrabsFor | null };
export type TaskEvent = {
  id: string; at: number; actor: string | null; taskId: string | null; title: string;
  person: string | null; action: 'created' | 'edited' | 'deleted' | 'claimed' | 'moved'; status: TaskStatus | null;
};
/** Time a person linked to a task in their shift reports. */
export type TaskTimeRow = { taskId: string; person: string; minutes: number };

export function validateTask(t: TaskInput, people?: string[]): string | null {
  if (people && !people.length && !t.grabsFor) return 'Choose whether this task is up for grabs for RCMs or for admins.';
  if (!t.title.trim()) return 'Give the task a title.';
  if (t.title.length > 200) return 'The title is too long.';
  if (t.description.length > 4000) return 'The description is too long.';
  if (!PRIORITIES.includes(t.priority)) return 'Pick a priority.';
  if (!(Number.isInteger(t.estimateMinutes) && t.estimateMinutes > 0 && t.estimateMinutes <= 100 * 60)) return 'Give the estimated time (up to 100 hours).';
  return null;
}

/** Admins see everything; RCMs their own tasks and the ones up for grabs; viewers nothing. */
export function canSeeTask(t: Task, me: Profile | null): boolean {
  if (!me || !me.active) return false;
  if (me.role === 'admin') return true;
  if (me.role !== 'rcm') return false;
  return t.assignees.some((a) => a.person === me.id) || (!t.assignees.length && t.grabsFor === 'rcm');
}

export type Card = { task: Task; person: string | null; status: TaskStatus | 'grabs'; doneAt: number | null };

/** One card per assignee (filtered to `person` when given), plus one per task up for grabs. */
export function taskCards(tasks: Task[], me: Profile | null, person: string | null): Card[] {
  const out: Card[] = [];
  for (const t of tasks) {
    if (!canSeeTask(t, me)) continue;
    if (!t.assignees.length) { if (!person) out.push({ task: t, person: null, status: 'grabs', doneAt: null }); continue; }
    for (const a of t.assignees) {
      if (me!.role === 'rcm' && a.person !== me!.id) continue;
      if (person && a.person !== person) continue;
      out.push({ task: t, person: a.person, status: a.status, doneAt: a.doneAt });
    }
  }
  return out;
}

const rank = (p: Priority) => PRIORITIES.indexOf(p);
export function column(cards: Card[], status: Card['status']): Card[] {
  const list = cards.filter((c) => c.status === status);
  return status === 'done'
    ? list.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    : list.sort((a, b) => rank(b.task.priority) - rank(a.task.priority) || a.task.createdAt - b.task.createdAt);
}

export function pageOf<T>(list: T[], page: number, size = 10): { items: T[]; pages: number } {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { items: list.slice(p * size, p * size + size), pages };
}

export function canMove(c: Card, me: Profile | null): boolean {
  if (!me || !me.active || !c.person) return false;
  return me.role === 'admin' || (me.role === 'rcm' && c.person === me.id);
}

export function taskTimeRows(reports: Report[]): TaskTimeRow[] {
  const sum = new Map<string, TaskTimeRow>();
  for (const r of reports) for (const t of r.tasks || []) {
    const k = `${t.taskId}|${r.owner}`;
    const row = sum.get(k) || { taskId: t.taskId, person: r.owner, minutes: 0 };
    row.minutes += t.minutes; sum.set(k, row);
  }
  return [...sum.values()];
}

export function actualMinutes(rows: TaskTimeRow[], taskId: string, person: string | null): number {
  return rows.filter((r) => r.taskId === taskId && (!person || r.person === person)).reduce((m, r) => m + r.minutes, 0);
}

export type EstimateLine = { tasks: number; estimate: number; actual: number; avgDiffPct: number };

/** Completed assignments (done in [from, to), people passing `include`): estimated vs reported time, per person and team. */
export function estimateStats(tasks: Task[], rows: TaskTimeRow[], from: number, to: number, include: (person: string) => boolean = () => true): { team: EstimateLine; people: Record<string, EstimateLine> } {
  const acc = new Map<string, { tasks: number; estimate: number; actual: number; pct: number }>();
  const team = { tasks: 0, estimate: 0, actual: 0, pct: 0 };
  for (const t of tasks) for (const a of t.assignees) {
    if (a.status !== 'done' || a.doneAt == null || a.doneAt < from || a.doneAt >= to || !include(a.person)) continue;
    const actual = actualMinutes(rows, t.id, a.person);
    const pct = ((actual - t.estimateMinutes) / t.estimateMinutes) * 100;
    const p = acc.get(a.person) || { tasks: 0, estimate: 0, actual: 0, pct: 0 };
    for (const x of [p, team]) { x.tasks++; x.estimate += t.estimateMinutes; x.actual += actual; x.pct += pct; }
    acc.set(a.person, p);
  }
  const line = (x: typeof team): EstimateLine => ({ tasks: x.tasks, estimate: x.estimate, actual: x.actual, avgDiffPct: x.tasks ? Math.round(x.pct / x.tasks) + 0 : 0 });
  return { team: line(team), people: Object.fromEntries([...acc].map(([k, v]) => [k, line(v)])) };
}

/** Tasks completed in [from, to): per person, and the whole team (admins included). */
export function completedCounts(tasks: Task[], from: number, to: number): { total: number; people: Record<string, number> } {
  const people: Record<string, number> = {};
  let total = 0;
  for (const t of tasks) for (const a of t.assignees) {
    if (a.status === 'done' && a.doneAt != null && a.doneAt >= from && a.doneAt < to) { people[a.person] = (people[a.person] || 0) + 1; total++; }
  }
  return { total, people };
}
