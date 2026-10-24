import { describe, it, expect } from 'vitest';
import { parseDbError, signInError } from './repo';

describe('signInError', () => {
  it('keeps wrong credentials generic', () => {
    expect(signInError('Invalid login credentials')).toMatchObject({ code: 'bad_login', message: 'Wrong username or password.' });
  });
  it('explains an unconfirmed login', () => {
    expect(signInError('Email not confirmed').message).toBe('This login is not confirmed yet. In Supabase, confirm the user (or recreate it with "Auto Confirm User").');
  });
  it('shows configuration and network problems as they are', () => {
    expect(signInError('Invalid API key')).toMatchObject({ code: 'network', message: 'Sign-in failed: Invalid API key. Check VITE_SUPABASE_ANON_KEY in Vercel.' });
    expect(signInError('Failed to fetch')).toMatchObject({ code: 'network', message: 'Sign-in failed: Failed to fetch. Check VITE_SUPABASE_URL in Vercel and your connection.' });
    expect(signInError('Something else')).toMatchObject({ code: 'network', message: 'Sign-in failed: Something else' });
  });
});

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

import { loadErrorText as _let, parseDbError as _pde } from './repo';
describe('loadErrorText', () => {
  it('says the database needs the latest migrations when a column is missing', () => {
    expect(_let(_pde('column tasks.grabs_for does not exist'))).toMatch(/missing the latest update \(column tasks.grabs_for does not exist\).*db push/);
  });
  it('shows the raw reason otherwise', () => {
    expect(_let(new Error('Failed to fetch'))).toBe('Could not load the schedule (Failed to fetch). Check your connection and reload the page.');
  });
});

describe('role name in database messages', () => {
  it('shows SCM where the database still says SCM', () => {
    expect(_pde('RCM_INVALID: that person has no active SCM login').message).toBe('That person has no active SCM login.');
    expect(_pde('RCM_INVALID: contracts can only go to active SCMs').message).toBe('Contracts can only go to active SCMs.');
  });
});
