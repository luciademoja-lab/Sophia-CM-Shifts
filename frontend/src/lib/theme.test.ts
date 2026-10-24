import { describe, it, expect } from 'vitest';
import { readTheme, nextTheme, THEME_KEY } from './theme';

const store = (v: string | null) => ({ getItem: (k: string) => (k === THEME_KEY ? v : null) });

describe('theme (chosen with the Light/Dark button, light by default)', () => {
  it('is light unless dark was chosen on this browser', () => {
    expect(readTheme(store(null))).toBe('light');
    expect(readTheme(store('dark'))).toBe('dark');
    expect(readTheme(store('light'))).toBe('light');
    expect(readTheme(store('purple'))).toBe('light');
  });
  it('falls back to light when storage is blocked', () => {
    expect(readTheme({ getItem: () => { throw new Error('blocked'); } })).toBe('light');
    expect(readTheme(null)).toBe('light');
  });
  it('toggles', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
  });
});
