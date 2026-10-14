import { expect, test } from '@playwright/test';
import { formatWhen } from '../../src/components/app/format';
import { signIn } from './support/session';
import { card } from './support/ui';
import { world } from './support/world';

/**
 * Confirmed shifts as an agenda (M08-01): by the day each starts, in Lagos time, with
 * Today / Next 7 days / All.
 *
 * The world's live shift starts about an hour from whenever the run began, so it is today, or
 * tomorrow if the run is within the hour of midnight in Lagos. The expected day is worked out here
 * on its own, from the same instant, so this does not borrow the app's own answer.
 */
const lagosDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

test('a practitioner reads their confirmed shifts by day, and narrows them', async ({ page }) => {
  await signIn(page, world().practitioner);
  await page.goto('/practitioner/shifts');

  const live = card(page, formatWhen(world().liveShift.startsAt));
  const startsToday = lagosDay(world().liveShift.startsAt) === today();

  // Everything first, grouped under the day each starts.
  await expect(page.getByRole('tab', { name: 'All' })).toHaveAttribute('data-state', 'active');
  await expect(live).toBeVisible();
  await expect(page.getByRole('heading', { name: startsToday ? 'Today' : 'Tomorrow', exact: true })).toBeVisible();

  // The next seven days include it either way.
  await page.getByRole('tab', { name: 'Next 7 days' }).click();
  await expect(live).toBeVisible();

  // Today keeps it only if it starts today; otherwise it says so rather than showing an empty page.
  await page.getByRole('tab', { name: 'Today' }).click();
  if (startsToday) {
    await expect(live).toBeVisible();
  } else {
    await expect(live).toHaveCount(0);
    await expect(page.getByText(/more shifts? later/)).toBeVisible();
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect(live).toBeVisible();
  }
});

test('a facility reads its roster by day', async ({ page }) => {
  await signIn(page, world().scheduler);
  await page.goto('/facility/roster');

  const row = page.getByRole('row').filter({ hasText: formatWhen(world().liveShift.startsAt) });
  await expect(row).toBeVisible();
  // A day heading row sits above the shift, in Lagos time.
  const heading = lagosDay(world().liveShift.startsAt) === today() ? 'Today' : 'Tomorrow';
  await expect(page.getByRole('row').filter({ hasText: new RegExp(`^${heading}$`) })).toBeVisible();
});
