import type { Repo } from './repo';

const READS = new Set(['mode', 'session', 'signIn', 'signOut', 'onAuthChange', 'subscribe']);
const isRead = (prop: string) => READS.has(prop) || prop.startsWith('load');

/** Wraps a repository so the board reloads right after each successful change made here. */
export function withRefresh(repo: Repo, refresh: () => void): Repo {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || isRead(prop) || typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        refresh();
        return result;
      };
    },
  });
}
