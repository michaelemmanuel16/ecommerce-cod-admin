// Dark mode (M3-T34, F-107). The attribute is the mockup's switch: data-theme="dark" on <html>.
// Storage can throw (private window, blocked site data), so every access is wrapped; without it the system setting wins.
// index.html runs the same logic before first paint so the page never flashes white.

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'codadmin-theme';

export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The saved choice, else the system setting. */
export const initialTheme = (): Theme => readStoredTheme() ?? systemTheme();

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // not saved; the choice lasts until reload
  }
}
