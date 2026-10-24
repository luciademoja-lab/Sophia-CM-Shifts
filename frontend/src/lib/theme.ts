// Light or dark, chosen with the button in the header and remembered on this browser.
// Light is the default; the dark theme never starts by itself from the computer's setting.
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'scm-theme';

export function readTheme(storage: { getItem(k: string): string | null } | null): Theme {
  try { return storage?.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

export const nextTheme = (t: Theme): Theme => (t === 'dark' ? 'light' : 'dark');

/** Sets the theme on the page and remembers it (best effort). */
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode: only this visit */ }
}

export function currentTheme(): Theme {
  try { return readTheme(localStorage); } catch { return 'light'; }
}
