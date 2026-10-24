import { expect, test } from '@playwright/test';

/**
 * The landing page's sections arrive as they are scrolled to (components/app/reveal.tsx).
 *
 * A section below the fold is put away after hydration and brought back when it meets the reader.
 * The way that goes wrong is silent: a section that is put away and never comes back is a block of
 * the page nobody can read, and it looks like a design choice, not a bug. The accessibility scan
 * cannot catch it, because it reads the page with reduced motion on, where nothing is hidden at all.
 *
 * Read-only, like the scan, and run with motion left on, which is the whole point.
 */

test('every section of the landing page arrives as it is scrolled to', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main').first()).toBeVisible();

  const sections = page.locator('.reveal');
  const away = page.locator('.reveal[data-reveal="hidden"]');
  expect(await sections.count(), 'the landing page has sections that arrive').toBeGreaterThan(0);

  // Hydrated, and putting the sections below the fold away: without this the page could be checked
  // before the mechanism has started, when nothing is hidden and every later assertion is vacuous.
  await expect(away.first()).toBeAttached();

  // Read the page the way a person does, a screenful at a time, rather than jumping to the end,
  // which would leave everything above the viewport where it was.
  const step = await page.evaluate(() => Math.round(window.innerHeight * 0.6));
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += step) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    // Two frames: the observer reports on the first and React draws the answer on the second.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
  }

  await expect(away).toHaveCount(0);
  // Not only marked as arrived: drawn. A rule that kept the section transparent would pass the line above.
  for (const section of await sections.all()) {
    await expect(section).toHaveCSS('opacity', '1');
  }
});
