import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/session';
import { world, type Person } from './support/world';

/**
 * An automated accessibility scan of the pages everybody meets first (UXA-16).
 *
 * The contrast test guards the stylesheet's colours and the journeys guard what the screens do;
 * nothing guarded what the rendered page tells assistive technology, so a button with no name or a
 * form field with no label could be shipped and nobody would know until somebody who needed it did.
 *
 * Only `serious` and `critical` findings fail the run. Axe also reports `moderate` and `minor`
 * things — a heading that skips a level, a landmark that is not unique — worth fixing, but not worth
 * stopping a release for, and a scan that fails on advice stops being run. The rest are printed, so
 * they are seen without being a gate.
 *
 * Read-only: nothing here changes data, so where it runs among the journeys does not matter. It
 * covers the consoles in both themes, since colour contrast is the finding most likely to differ.
 */

const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(RULES).analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  const advice = results.violations.filter((violation) => !blocking.includes(violation));

  if (advice.length > 0) {
    console.log(
      `${label}: ${advice.length} lesser finding(s): ` +
        advice.map((violation) => `${violation.id} (${violation.impact})`).join(', '),
    );
  }

  // A short line per finding, not axe's whole object: the diff of a failed `toEqual` on the raw result
  // is hundreds of lines, and the first thing anybody needs is which rule and which element.
  const found = blocking.map(
    (violation) =>
      `${violation.id} [${violation.impact}] ${violation.help} — ` +
      violation.nodes
        .slice(0, 4)
        // The first check's own message carries the numbers for a contrast failure: the ratio and both colours.
        .map((node) => `${node.target.join(' ')}${node.any[0]?.message ? ` {${node.any[0].message}}` : ''}`)
        .join(' | ') +
      (violation.nodes.length > 4 ? ` (+${violation.nodes.length - 4} more)` : ''),
  );

  expect(found, `${label} has serious or critical accessibility findings`).toEqual([]);
}

const PUBLIC: [string, string][] = [
  ['/', 'the landing page'],
  ['/login', 'sign in'],
  ['/register', 'create an account'],
  ['/contact', 'contact'],
];

for (const [path, name] of PUBLIC) {
  test(`${name} has no serious accessibility findings`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main').first()).toBeVisible();
    await scan(page, name);
  });
}

const CONSOLES: [string, string, (() => Person)][] = [
  ['/admin', 'the operations dashboard', () => world().admin],
  ['/facility', 'the facility dashboard', () => world().owner],
  ['/practitioner', 'the practitioner dashboard', () => world().practitioner],
];

for (const theme of ['light', 'dark'] as const) {
  for (const [path, name, who] of CONSOLES) {
    test(`${name} (${theme}) has no serious accessibility findings`, async ({ page }) => {
      await page.addInitScript((chosen) => {
        try {
          window.localStorage.setItem('medilink:theme', chosen);
        } catch {
          // The scan still runs in the device's own theme.
        }
      }, theme);
      await signIn(page, who());
      await page.goto(path);
      // The page has drawn once its heading is there and its first requests have settled.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await scan(page, `${name} (${theme})`);
    });
  }
}
