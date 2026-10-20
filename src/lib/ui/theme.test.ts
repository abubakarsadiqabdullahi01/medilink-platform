import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEMED_PATH, THEME_INIT_SCRIPT, THEME_KEY, resolveTheme } from './theme';

/** Runs the <head> script the way a browser would and reports whether it darkened the page. */
function scriptDarkens(options: { path: string; stored: string | null; systemDark: boolean }): boolean {
  const classes = new Set<string>();
  runInNewContext(THEME_INIT_SCRIPT, {
    location: { pathname: options.path },
    localStorage: { getItem: (key: string) => (key === THEME_KEY ? options.stored : null) },
    matchMedia: () => ({ matches: options.systemDark }),
    document: { documentElement: { classList: { add: (name: string) => classes.add(name) } } },
  });
  return classes.has('dark');
}

describe('resolveTheme', () => {
  it('lets an explicit choice beat the device setting, either way round', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the device when nothing has been chosen', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('ignores a stored value it does not recognise', () => {
    expect(resolveTheme('purple', true)).toBe('dark');
    expect(resolveTheme('', false)).toBe('light');
  });
});

describe('the pre-paint script', () => {
  const stored = [null, 'light', 'dark', 'garbage'] as const;

  it('makes exactly the decision resolveTheme makes, in a console', () => {
    for (const value of stored) {
      for (const systemDark of [true, false]) {
        expect(scriptDarkens({ path: '/facility/shifts', stored: value, systemDark })).toBe(
          resolveTheme(value, systemDark) === 'dark',
        );
      }
    }
  });

  it('never darkens a public page, whatever is stored or set', () => {
    for (const path of ['/', '/login', '/register', '/contact', '/privacy', '/administrators']) {
      expect(scriptDarkens({ path, stored: 'dark', systemDark: true })).toBe(false);
    }
  });

  it('treats the three console roots, and everything under them, as consoles', () => {
    for (const path of ['/admin', '/facility', '/practitioner', '/admin/audit', '/practitioner/offers']) {
      expect(THEMED_PATH.test(path)).toBe(true);
    }
    expect(THEMED_PATH.test('/administrators')).toBe(false);
  });

  it('falls back to the device setting, rather than throwing, when storage is blocked', () => {
    for (const systemDark of [true, false]) {
      const classes = new Set<string>();
      expect(() =>
        runInNewContext(THEME_INIT_SCRIPT, {
          location: { pathname: '/admin' },
          localStorage: {
            getItem: () => {
              throw new Error('blocked');
            },
          },
          matchMedia: () => ({ matches: systemDark }),
          document: { documentElement: { classList: { add: (name: string) => classes.add(name) } } },
        }),
      ).not.toThrow();
      expect(classes.has('dark')).toBe(systemDark);
    }
  });
});
