import { describe, it, expect } from 'vitest';
import {
  normalizeUsername, validateUsername, loginEmail, validatePassword, usernameToEmail, emailToUsername, generatePassword, LOGIN_DOMAIN,
} from '../../../backend/supabase/functions/_shared/username.ts';

describe('usernames (logins made by us)', () => {
  it('normalizes case and spaces', () => {
    expect(normalizeUsername('  Regina.N ')).toBe('regina.n');
  });
  it('accepts simple handles', () => {
    expect(validateUsername('regina')).toBeNull();
    expect(validateUsername('kris_arevalo-2')).toBeNull();
  });
  it('rejects bad handles with a reason', () => {
    expect(validateUsername('ab')).toBe('Username must be 3 to 32 characters.');
    expect(validateUsername('a'.repeat(33))).toBe('Username must be 3 to 32 characters.');
    expect(validateUsername('regina nemeth')).toBe('Use only letters, numbers, dots, dashes and underscores.');
    expect(validateUsername('.regina')).toBe('Start with a letter or a number.');
    expect(validateUsername('régina')).toBe('Use only letters, numbers, dots, dashes and underscores.');
  });
  it('signs in with a username or, if typed, a full email', () => {
    expect(loginEmail(' Lucia ')).toBe(`lucia@${LOGIN_DOMAIN}`);
    expect(loginEmail(' Operations2@VikStudios.com ')).toBe('operations2@vikstudios.com');
  });
  it('maps a username to the internal sign-in email and back', () => {
    expect(usernameToEmail('Regina')).toBe(`regina@${LOGIN_DOMAIN}`);
    expect(emailToUsername(`regina@${LOGIN_DOMAIN}`)).toBe('regina');
    expect(emailToUsername('someone@gmail.com')).toBeNull();
  });
});

describe('passwords', () => {
  it('requires at least 10 characters with a letter and a number', () => {
    expect(validatePassword('short1')).toBe('Password must be at least 10 characters.');
    expect(validatePassword('onlyletters')).toBe('Password needs at least one letter and one number.');
    expect(validatePassword('1234567890')).toBe('Password needs at least one letter and one number.');
    expect(validatePassword('shifts2026ok')).toBeNull();
  });
  it('generates passwords that pass the rules and avoid look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(12);
      expect(validatePassword(p)).toBeNull();
      expect(p).not.toMatch(/[0O1lI]/);
    }
  });
});
