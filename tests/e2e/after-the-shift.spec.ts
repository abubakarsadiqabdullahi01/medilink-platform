import { expect, test, type Page } from '@playwright/test';
import { formatNaira, formatWhen } from '../../src/components/app/format';
import { signIn, switchTo } from './support/session';
import { card, choose, eventually, expectToast, lagosLocal } from './support/ui';
import { world } from './support/world';

/**
 * After the shift: recorded, priced, submitted, approved, disputed, decided.
 *
 * The ward's network was down, so the facility records the shift by hand.
 * The worker prices it; the nurse submits; the facility approves; the nurse
 * disputes the hours; an administrator takes the case and decides it.
 *
 * The timesheet appears through the outbox worker (ShiftCompleted), which the
 * page cannot be told about, so that one step reloads until it is there.
 */
test.describe.configure({ mode: 'serial' });

const HOUR = 60 * 60 * 1000;
const shift = () => world().afterShift;
const shiftLabel = () => formatWhen(shift().startsAt);
// Eight hours at the rate agreed when it was offered, in kobo and then naira.
const expected = () => formatNaira(8 * shift().hourlyRateKobo);

async function facilityTimesheet(page: Page) {
  await page.goto('/facility/timesheets');
  return card(page, world().practitioner.fullName).filter({ hasText: shiftLabel() });
}

test('the ward records the shift by hand when no code could be exchanged', async ({ page }) => {
  await signIn(page, world().scheduler);
  await page.goto('/facility/roster');
  await page.getByLabel('Search by practitioner').fill(world().practitioner.fullName);
  await page.getByRole('button', { name: 'Search' }).click();

  const row = page.getByRole('row').filter({ hasText: shiftLabel() });
  await row.getByRole('button', { name: 'Record by hand' }).click();

  const dialog = page.getByRole('dialog', { name: 'Record this shift by hand' });
  const from = new Date(shift().startsAt);
  await dialog.getByLabel('Checked in').fill(lagosLocal(from));
  await dialog.getByLabel('Checked out').fill(lagosLocal(new Date(from.getTime() + 8 * HOUR)));
  await dialog.getByLabel('Unpaid break (minutes)').fill('0');
  await dialog
    .getByLabel(/Why by hand/)
    .fill('Ward network was down for the whole shift; times taken from the nursing paper log.');
  await dialog.getByRole('button', { name: 'Record it' }).click();

  await expectToast(page, 'Recorded by hand');
  await expect(row.getByText(/manually corrected/i)).toBeVisible();
});

test('the nurse submits the timesheet the worker priced', async ({ page }) => {
  await signIn(page, world().practitioner);
  await page.goto('/practitioner/timesheets');

  const sheet = card(page, shiftLabel());
  const submit = sheet.getByRole('button', { name: `Submit ${expected()}` });
  await eventually(page, async () => {
    await expect(submit).toBeVisible({ timeout: 5_000 });
  });
  await expect(sheet.getByText('8h', { exact: true }).first()).toBeVisible();

  await submit.click();
  await expectToast(page, 'Submitted');
  await expect(submit).toBeHidden();
});

test('the facility will not reject without a reason, and approves', async ({ page }) => {
  await signIn(page, world().scheduler);
  const sheet = await facilityTimesheet(page);

  await expect(sheet.getByRole('button', { name: 'Reject' })).toBeDisabled();
  await sheet.getByRole('button', { name: `Approve ${expected()}` }).click();
  await expectToast(page, 'Approved — the shift is now completed');
});

test('the nurse disputes the approved hours', async ({ page }) => {
  await signIn(page, world().practitioner);
  await page.goto('/practitioner/timesheets');

  await card(page, shiftLabel()).getByRole('button', { name: 'Dispute this' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dispute this shift' });
  await choose(dialog, 'What is wrong', 'The hours are wrong');
  const open = dialog.getByRole('button', { name: 'Open the dispute' });
  await dialog.getByLabel('In your words').fill('Too short.');
  await expect(open).toBeDisabled();
  await dialog
    .getByLabel('In your words')
    .fill('I stayed ninety minutes past handover; the paper log on the ward shows it.');
  await open.click();

  await expectToast(page, 'Dispute opened');
});

test('an administrator takes the case and decides it', async ({ page }) => {
  await signIn(page, world().admin);
  await page.goto('/admin/disputes');
  await page.getByLabel('Search by practitioner or facility').fill(world().practitioner.fullName);
  await page.getByRole('button', { name: 'Search' }).click();

  await page
    .getByRole('button')
    .filter({ hasText: world().practitioner.fullName })
    .filter({ hasText: shiftLabel() })
    .click();

  await page.getByRole('button', { name: 'Start reviewing' }).click();
  await expectToast(page, 'Marked as under review');

  await page
    .getByLabel(/Your finding/)
    .fill('The ward paper log shows handover at the scheduled time; the approved hours stand.');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expectToast(page, 'Dismissed');

  // The decision reaches the facility's side too: the shift is out of dispute.
  await switchTo(page, world().scheduler);
  await page.goto('/facility/timesheets');
  await page.getByRole('tab', { name: 'approved' }).click();
  await expect(card(page, world().practitioner.fullName).filter({ hasText: shiftLabel() })).toBeVisible();
});
