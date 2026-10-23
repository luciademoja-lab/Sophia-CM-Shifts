import { describe, it, expect } from 'vitest';
import { errorText } from './errors';
import { RepoError } from '../data/repo';

describe('errorText', () => {
  it('explains overlaps in the viewer time zone', () => {
    const e = new RepoError('overlap', 'x', { who: 'Regina Nemeth', start: Date.parse('2026-10-26T08:00Z'), end: Date.parse('2026-10-26T10:00Z') });
    expect(errorText(e, 'Europe/Rome')).toBe("This overlaps Regina Nemeth's shift, Mon 26 Oct 09:00–11:00. Only one RCM per slot.");
  });
  it('passes through permission messages and hides unknown errors', () => {
    expect(errorText(new RepoError('forbidden', 'Only admins can change the coverage target.'), 'UTC')).toBe('Only admins can change the coverage target.');
    expect(errorText(new Error('boom'), 'UTC')).toBe('Something went wrong. Reload the page and try again.');
  });
});
