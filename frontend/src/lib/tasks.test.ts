import { describe, it, expect } from 'vitest';
import { validateTask, canSeeTask, taskCards, column, pageOf, canMove, actualMinutes, taskTimeRows, estimateStats, completedCounts, type Task } from './tasks';
import type { Profile, Report } from './shifts';

const prof = (id: string, role: Profile['role']): Profile => ({ id, username: id, fullName: id.toUpperCase(), role, timezone: 'UTC', active: true });
const lucia = prof('lucia', 'admin'), regina = prof('regina', 'rcm'), max = prof('max', 'viewer');

const H = 3_600_000;
const task = (id: string, assignees: Array<[string, 'todo' | 'in_progress' | 'done', number?]>, extra: Partial<Task> = {}): Task => ({
  id, title: id, description: '', priority: 'normal', estimateMinutes: 60, grabsFor: 'rcm', createdBy: 'lucia', createdAt: 0,
  assignees: assignees.map(([person, status, doneAt]) => ({ person, status, doneAt: doneAt ?? null, updatedAt: 0 })), ...extra,
});

describe('validateTask', () => {
  it('needs a title, a known priority and an estimate', () => {
    expect(validateTask({ title: ' ', description: '', priority: 'normal', estimateMinutes: 60 })).toMatch(/title/);
    expect(validateTask({ title: 'x', description: '', priority: 'whenever' as never, estimateMinutes: 60 })).toMatch(/priority/);
    expect(validateTask({ title: 'x', description: '', priority: 'high', estimateMinutes: 0 })).toMatch(/estimated time/);
    expect(validateTask({ title: 'x', description: '', priority: 'high', estimateMinutes: 90 })).toBeNull();
  });
  it('asks who can grab a task created without assignees', () => {
    const t = { title: 'x', description: '', priority: 'high' as const, estimateMinutes: 90 };
    expect(validateTask({ ...t, grabsFor: null }, [])).toMatch(/up for grabs/);
    expect(validateTask({ ...t, grabsFor: 'admin' }, [])).toBeNull();
    expect(validateTask({ ...t, grabsFor: null }, ['regina'])).toBeNull();
  });
});

describe('who sees which task', () => {
  const mine = task('mine', [['regina', 'todo']]);
  const krisOnly = task('kris', [['kris', 'todo']]);
  const adminOnly = task('admin', [['lucia', 'todo']]);
  const shared = task('shared', [['lucia', 'todo'], ['regina', 'in_progress']]);
  const grab = task('grab', []);
  const adminGrab = task('admin grab', [], { grabsFor: 'admin' });
  it('shows admins every task', () => {
    expect([mine, krisOnly, adminOnly, shared, grab, adminGrab].every((t) => canSeeTask(t, lucia))).toBe(true);
  });
  it("shows RCMs their own tasks and the ones up for grabs, never admins' or colleagues'", () => {
    expect([mine, krisOnly, adminOnly, shared, grab, adminGrab].filter((t) => canSeeTask(t, regina)).map((t) => t.id)).toEqual(['mine', 'shared', 'grab']);
  });
  it('hides tasks from viewers', () => {
    expect(canSeeTask(grab, max)).toBe(false);
  });
});

describe('task cards and columns', () => {
  const tasks = [
    task('a', [['regina', 'todo'], ['kris', 'done', 5 * H]], { priority: 'low' }),
    task('b', [['regina', 'todo']], { priority: 'urgent' }),
    task('c', []),
    task('d', [['regina', 'done', 2 * H]]),
    task('e', [['regina', 'done', 9 * H]]),
  ];
  it('gives each assignee their own card, plus one card for tasks up for grabs', () => {
    expect(taskCards(tasks, lucia, null).map((c) => `${c.task.id}:${c.person ?? '-'}`)).toEqual(['a:regina', 'a:kris', 'b:regina', 'c:-', 'd:regina', 'e:regina']);
    expect(taskCards(tasks, lucia, 'kris').map((c) => c.task.id)).toEqual(['a']);
    expect(taskCards(tasks, regina, null).map((c) => `${c.task.id}:${c.person ?? '-'}`)).toEqual(['a:regina', 'b:regina', 'c:-', 'd:regina', 'e:regina']);
  });
  it('sorts to do by priority and done by most recent', () => {
    const cards = taskCards(tasks, regina, null);
    expect(column(cards, 'todo').map((c) => c.task.id)).toEqual(['b', 'a']);
    expect(column(cards, 'done').map((c) => c.task.id)).toEqual(['e', 'd']);
    expect(column(cards, 'grabs').map((c) => c.task.id)).toEqual(['c']);
  });
  it('lets RCMs move only their own card, admins any card', () => {
    const [aRegina, aKris] = taskCards(tasks, lucia, null);
    expect(canMove(aRegina, regina)).toBe(true);
    expect(canMove(aKris, regina)).toBe(false);
    expect(canMove(aKris, lucia)).toBe(true);
    expect(canMove(aKris, max)).toBe(false);
  });
  it('pages the done column 10 at a time', () => {
    const list = Array.from({ length: 23 }, (_, i) => i);
    expect(pageOf(list, 0)).toEqual({ items: list.slice(0, 10), pages: 3 });
    expect(pageOf(list, 2)).toEqual({ items: [20, 21, 22], pages: 3 });
    expect(pageOf([], 0)).toEqual({ items: [], pages: 1 });
  });
});

describe('estimated vs actual time', () => {
  const rep = (owner: string, tasks: Array<[string, number]>): Report => ({ shiftId: owner + tasks.length, owner, workedMinutes: 600, notes: '', workTypes: [], posters: '', tasks: tasks.map(([taskId, minutes]) => ({ taskId, minutes })), updatedAt: 0, updatedBy: owner });
  const rows = taskTimeRows([rep('regina', [['a', 30], ['b', 60]]), rep('regina', [['a', 60]]), rep('kris', [['a', 45]])]);

  it('adds up the time each person linked to a task from their reports', () => {
    expect(actualMinutes(rows, 'a', 'regina')).toBe(90);
    expect(actualMinutes(rows, 'a', 'kris')).toBe(45);
    expect(actualMinutes(rows, 'a', null)).toBe(135);
  });

  it('compares the estimate with the reported time per RCM and for the team, on completed tasks', () => {
    const tasks = [
      task('a', [['regina', 'done', 3 * H], ['kris', 'done', 4 * H]], { estimateMinutes: 60 }), // regina 90 (+50%), kris 45 (−25%)
      task('b', [['regina', 'done', 5 * H]], { estimateMinutes: 120 }), // regina 60 (−50%)
      task('c', [['kris', 'in_progress']], { estimateMinutes: 60 }), // not done: ignored
    ];
    const s = estimateStats(tasks, rows, 0, 10 * H);
    expect(s.people.regina).toEqual({ tasks: 2, estimate: 180, actual: 150, avgDiffPct: 0 });
    expect(s.people.kris).toEqual({ tasks: 1, estimate: 60, actual: 45, avgDiffPct: -25 });
    expect(s.team).toEqual({ tasks: 3, estimate: 240, actual: 195, avgDiffPct: -8 });
    expect(estimateStats(tasks, rows, 4.5 * H, 10 * H).team.tasks).toBe(1);
  });

  it('can leave admins out of the speed metrics', () => {
    const tasks = [task('a', [['regina', 'done', 3 * H], ['lucia', 'done', 4 * H]], { estimateMinutes: 60 })];
    const s = estimateStats(tasks, rows, 0, 10 * H, (id) => id !== 'lucia');
    expect(s.team.tasks).toBe(1);
    expect(s.people.lucia).toBeUndefined();
  });

  it('counts tasks completed in a week, per person and for the whole team', () => {
    const tasks = [
      task('a', [['regina', 'done', 3 * H], ['lucia', 'done', 4 * H]]),
      task('b', [['regina', 'done', 50 * H]]),
      task('c', [['kris', 'done', 5 * H]]),
    ];
    expect(completedCounts(tasks, 0, 10 * H)).toEqual({ total: 3, people: { regina: 1, lucia: 1, kris: 1 } });
  });
});
