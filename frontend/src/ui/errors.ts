import { RepoError } from '../data/repo';
import { rangeLabel } from '../lib/time';

/** A sentence for the user, for any error thrown by the repository. */
export function errorText(e: unknown, tz: string): string {
  if (e instanceof RepoError) {
    if (e.code === 'overlap' && e.overlap) return `This overlaps ${e.overlap.who}'s shift, ${rangeLabel(e.overlap.start, e.overlap.end, tz)}. Only one SCM per slot.`;
    if (e.code === 'overlap') return 'This overlaps another shift. Only one SCM per slot.';
    if (e.code === 'network') return 'Could not save. Check your connection and try again.';
    return e.message;
  }
  return 'Something went wrong. Reload the page and try again.';
}
