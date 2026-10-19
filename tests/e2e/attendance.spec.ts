import { expect, test, type Page } from '@playwright/test';
import { formatShiftWindow, formatWhen } from '../../src/components/app/format';
import { signIn } from './support/session';
import { card, expectToast } from './support/ui';
import { world } from './support/world';

/**
 * Checking in with a code the ward reads out.
 *
 * The facility issues a six-digit code from its roster; the practitioner types
 * it into her own phone. Two consoles, one real token exchange, twice — in and
 * out — on the shift the world builder confirmed to start within the hour.
 */
test.describe.configure({ mode: 'serial' });

/** Her row on the roster for this shift, out of the three she is booked on. */
async function rosterRow(page: Page) {
  await page.goto('/facility/roster');
  await page.getByLabel('Search by practitioner').fill(world().practitioner.fullName);
  await page.getByRole('button', { name: 'Search' }).click();
  const { startsAt, endsAt } = world().liveShift;
  return page.getByRole('row').filter({ hasText: formatShiftWindow(startsAt, endsAt) });
}

/** Issues a code from the roster and reads it off the dialog, as a ward would. */
async function issueCode(page: Page, button: 'Code to check in' | 'Code to check out') {
  await signIn(page, world().scheduler);
  const row = await rosterRow(page);
  await row.getByRole('button', { name: button }).click();

  const dialog = page.getByRole('dialog', { name: 'Read this to the practitioner' });
  const code = (await dialog.locator('p.tabular').innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  return code;
}

async function present(page: Page, code: string, button: 'Check in' | 'Check out') {
  await page.context().clearCookies();
  await signIn(page, world().practitioner);
  await page.goto('/practitioner/shifts');

  const shift = card(page, formatWhen(world().liveShift.startsAt));
  await shift.getByLabel(/Code from the ward/).fill(code);
  await shift.getByRole('button', { name: button }).click();
}

test('a code from the ward checks the nurse in', async ({ page }) => {
  const code = await issueCode(page, 'Code to check in');
  await present(page, code, 'Check in');
  await expectToast(page, 'Checked in');
  await expect(card(page, formatWhen(world().liveShift.startsAt)).getByText(/^in /)).toBeVisible();
});

test('a wrong code is refused and changes nothing', async ({ page }) => {
  await signIn(page, world().practitioner);
  await page.goto('/practitioner/shifts');
  const shift = card(page, formatWhen(world().liveShift.startsAt));
  await shift.getByLabel(/Code from the ward/).fill('000000');
  await shift.getByRole('button', { name: 'Check out' }).click();
  await expectToast(page, 'That code did not work');
});

test('a second code checks her out', async ({ page }) => {
  const code = await issueCode(page, 'Code to check out');
  await present(page, code, 'Check out');
  await expectToast(page, 'Checked out');

  // The facility sees the same record from its side.
  await page.context().clearCookies();
  await signIn(page, world().scheduler);
  const row = await rosterRow(page);
  await expect(row.getByText(/· out /)).toBeVisible();
});
