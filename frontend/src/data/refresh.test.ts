import { describe, it, expect } from 'vitest';
import { withRefresh } from './refresh';
import type { Repo } from './repo';

describe('withRefresh (the board updates right after your own changes, even without realtime)', () => {
  const calls: string[] = [];
  const base = {
    mode: 'demo',
    async load() { calls.push('load'); return {}; },
    async loadHoursHistory() { return { versions: [], worked: [] }; },
    async bookShift() { calls.push('book'); return 'id'; },
    async createTask() { calls.push('task'); return 't'; },
    async markNotificationsSeen() { calls.push('seen'); },
    async setMyTimezone() { calls.push('tz'); },
    async deleteShift() { throw new Error('nope'); },
    subscribe() { return () => undefined; },
  } as unknown as Repo;

  it('refreshes after every successful write, and passes the result through', async () => {
    let refreshed = 0;
    const repo = withRefresh(base, () => { refreshed++; });
    expect(await repo.bookShift(1, 2)).toBe('id');
    expect(await repo.createTask({ title: 'x', description: '', priority: 'low', estimateMinutes: 1 }, [])).toBe('t');
    await repo.markNotificationsSeen();
    await repo.setMyTimezone('Europe/Rome');
    expect(refreshed).toBe(4);
    await repo.load(0, 1);
    await repo.loadHoursHistory(0, 1);
    expect(refreshed).toBe(4); // reads do not trigger a refresh (or the board would reload forever)
    await expect(repo.deleteShift('x')).rejects.toThrow('nope');
    expect(refreshed).toBe(4); // failures neither
    expect(repo.mode).toBe('demo');
  });
});
