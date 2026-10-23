import { describe, it, expect } from 'vitest';
import { parseDbError } from './repo';

describe('parseDbError', () => {
  it('reads overlaps, with who and when', () => {
    const e = parseDbError("RCM_OVERLAP: overlaps Regina Nemeth's shift 2026-10-26T08:00Z/2026-10-26T10:00Z");
    expect(e.code).toBe('overlap');
    expect(e.overlap).toEqual({ who: 'Regina Nemeth', start: Date.parse('2026-10-26T08:00Z'), end: Date.parse('2026-10-26T10:00Z') });
  });
  it('maps the other codes to readable messages', () => {
    expect(parseDbError('RCM_FORBIDDEN: only admins can change the coverage target').code).toBe('forbidden');
    expect(parseDbError('RCM_FORBIDDEN: only admins can change the coverage target').message).toBe('Only admins can change the coverage target.');
    expect(parseDbError('RCM_INVALID: unknown time zone X').code).toBe('invalid');
    expect(parseDbError('RCM_NOT_SIGNED_IN').code).toBe('not_signed_in');
  });
  it('treats the raw constraint as an overlap and anything else as a network problem', () => {
    expect(parseDbError('conflicting key value violates exclusion constraint "shifts_one_rcm_per_slot"').code).toBe('overlap');
    expect(parseDbError('Failed to fetch').code).toBe('network');
  });
});
