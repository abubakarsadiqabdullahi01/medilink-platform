import { expect, test } from '@playwright/test';
import { signIn } from './support/session';
import { world } from './support/world';

/**
 * Somebody who works at two hospitals.
 *
 * The facility console used to act for the first facility on the account and
 * say so on the dashboard — "switching between them is not built yet". Now
 * it asks, remembers the answer in this browser, and every page follows it.
 */
test('a scheduler at two hospitals chooses which one the console acts for', async ({ page }) => {
  const { facility, pendingFacility, multisite } = world();
  await signIn(page, multisite);
  await page.goto('/facility');

  const heading = page.getByRole('heading', { level: 1 });
  const switcher = page.getByRole('combobox', { name: 'Acting for' });
  await expect(switcher).toBeVisible();
  // The heading reads "Your facility" until the name arrives.
  await expect(heading).toHaveText(new RegExp(`^(${facility.name}|${pendingFacility.name})$`));
  const first = (await heading.innerText()).trim();
  expect([facility.name, pendingFacility.name]).toContain(first);
  const other = first === facility.name ? pendingFacility.name : facility.name;

  await switcher.click();
  await page.getByRole('option', { name: other }).click();
  await expect(heading).toHaveText(other);

  // Remembered, and followed by every page rather than only the dashboard.
  await page.reload();
  await expect(heading).toHaveText(other);
  await page.goto('/facility/shifts');
  await expect(page.getByRole('combobox', { name: 'Acting for' })).toHaveText(other);
});

test('somebody at one hospital is not offered a choice of one', async ({ page }) => {
  await signIn(page, world().scheduler);
  await page.goto('/facility');
  await expect(page.getByRole('heading', { level: 1, name: world().facility.name })).toBeVisible();
  await expect(page.getByText('Acting for')).toHaveCount(0);
});
