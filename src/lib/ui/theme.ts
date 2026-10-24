/**
 * The console's colour theme (UXA-13).
 *
 * The theme used to be read from storage in an effect, after the first paint, so
 * every reload of a dark console flashed white, and a person who had never chosen
 * anything got light whatever their phone was set to. Now:
 *
 * - an explicit choice (the toggle) wins and is remembered on this device;
 * - otherwise the device's own setting (`prefers-color-scheme`) decides;
 * - a small script in <head> applies it before anything is painted.
 *
 * Only the consoles take the dark theme. The public pages are light by design, and
 * a `dark` left on <html> once rendered the landing page as white on white.
 */

export const THEME_KEY = 'medilink:theme';

export type Theme = 'light' | 'dark';

/** The routes that carry a theme. Anything else (landing, sign-in, 404) stays light. */
export const THEMED_PATH = /^\/(admin|facility|practitioner)(\/|$)/;

export function resolveTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === 'dark' || stored === 'light') return stored;
  return systemDark ? 'dark' : 'light';
}

/** What this device says right now, without touching the page. */
export function readTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
  } catch {
    // Storage can be blocked outright; the device setting still applies.
  }
  const systemDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return resolveTheme(stored, systemDark);
}

/** True once somebody has used the toggle, so the device setting stops deciding. */
export function hasChosenTheme(): boolean {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === 'dark' || stored === 'light';
  } catch {
    return false;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private browsing: the toggle still works for this visit.
  }
}

/**
 * The same decision as `resolveTheme`, written to run before React exists. It has
 * to be a string, so it cannot import anything; theme.test.ts runs it against
 * `resolveTheme` for every combination so the two cannot drift apart.
 */
export const THEME_INIT_SCRIPT = `(function(){try{if(!${THEMED_PATH.toString()}.test(location.pathname))return;var s=null;try{s=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}var d=s==='dark'||(s!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})();`;
