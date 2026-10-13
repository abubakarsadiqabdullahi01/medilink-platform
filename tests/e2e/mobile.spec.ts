import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/session';
import { world } from './support/world';

/**
 * The practitioner's side at phone size.
 *
 * Practitioners are mobile-first: most will only ever see Medilink on a
 * phone, standing in a corridor. This runs on the Pixel 5 profile after the
 * journeys (playwright.config.ts), so the nurse's pages have real offers,
 * shifts and timesheets on them, and checks the one thing that breaks most
 * quietly at that width: content wider than the screen.
 */

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow, `${page.url()} is ${overflow}px wider than the screen`).toBeLessThanOrEqual(1);
}

for (const path of ['/', '/login', '/register']) {
  test(`${path} fits a phone`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main').first()).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
}

for (const [path, heading] of [
  ['/practitioner', /^Hello, /],
  ['/practitioner/offers', 'Offers'],
  ['/practitioner/shifts', 'My shifts'],
  ['/practitioner/timesheets', 'Timesheets'],
  ['/practitioner/earnings', 'Earnings'],
  // Four tabs and a wizard in one page: the likeliest thing here to push the
  // page sideways, so each way in is checked.
  ['/practitioner/profile', /^(My profile|Set up your profile)$/],
  ['/practitioner/profile?tab=credentials', 'My profile'],
  ['/practitioner/profile?tab=availability', 'My profile'],
  ['/practitioner/profile?tab=privacy', 'My profile'],
] as const) {
  test(`${path} fits a phone`, async ({ page }) => {
    await signIn(page, world().practitioner);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
}

test('the console menu opens on a phone and reaches another page', async ({ page }) => {
  await signIn(page, world().practitioner);
  await page.goto('/practitioner');
  await expect(page.getByRole('heading', { level: 1, name: /^Hello, / })).toBeVisible();

  // The sidebar is off-canvas at this width; its trigger has to work.
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'My shifts' }).click();
  await expect(page).toHaveURL(/\/practitioner\/shifts$/);
});
