import { expect, test, type Page } from '@playwright/test';
import { confirmPassword, signIn } from './support/session';
import { card, confirmItIsYou, expectToast, lagosLocal, toastsGone } from './support/ui';
import { world } from './support/world';

/**
 * Approved work, through to money in a nurse's account.
 *
 * An administrator invoices the hospital for the shift the world builder
 * approved yesterday; the hospital sees what it owes; the payment is recorded;
 * the nurse sees what she is owed; she is paid. Both money pages — the
 * facility's invoices and the practitioner's earnings — exist because a
 * walk through this story found nowhere for either side to look.
 *
 * The amounts are read off the invoice rather than hard-coded. If the
 * after-the-shift journey ran first, today's shift is on the same invoice,
 * and the point is that every page agrees with it — not what it adds up to.
 */
test.describe.configure({ mode: 'serial' });

const DAY = 24 * 60 * 60 * 1000;
let gross = '';

/** The amount a money page shows under `label`, as written. */
function figure(page: Page, label: string) {
  return page.getByRole('group', { name: label, exact: true }).locator('p.tabular');
}

test('an administrator raises an invoice for the approved work and issues it', async ({ page }) => {
  await signIn(page, world().admin);
  await page.goto('/admin/invoices');

  await page.getByLabel('Facility').click();
  await page.getByPlaceholder('Search facilities…').fill('E2E General');
  await page.getByRole('option', { name: /^E2E General Hospital/ }).click();
  await page.getByLabel('From').fill(lagosLocal(new Date(Date.now() - 3 * DAY)).slice(0, 10));
  await page.getByLabel('Until').fill(lagosLocal(new Date()).slice(0, 10));
  await page.getByRole('button', { name: 'Raise' }).click();
  // Money moves from here, so the first act of a sign-in asks for the password again;
  // the issue below is inside the few minutes that answer is good for.
  await confirmItIsYou(page);
  await expectToast(page, 'Draft raised');

  const invoice = card(page, world().practitioner.fullName).filter({
    has: page.getByRole('button', { name: 'Issue it' }),
  });
  gross = (await invoice.locator('p.tabular.text-lg').innerText()).trim();
  expect(gross).toMatch(/^₦[\d,]+\.\d{2}$/);
  // The draft's toast can sit over this button once it is scrolled into view, and then never leaves.
  await toastsGone(page);
  await invoice.getByRole('button', { name: 'Issue it' }).click();
  await expectToast(page, 'Issued');
});

test('the hospital sees what it owes, shift by shift', async ({ page }) => {
  await signIn(page, world().scheduler);
  await page.goto('/facility/invoices');

  await expect(figure(page, 'Outstanding')).toHaveText(gross);
  const invoice = card(page, gross);
  await expect(invoice.getByText(world().practitioner.fullName).first()).toBeVisible();
  await expect(invoice.getByText(/issued/i).first()).toBeVisible();
});

test('the payment is recorded, and the hospital owes nothing', async ({ page }) => {
  await signIn(page, world().admin);
  await confirmPassword(page);
  await page.goto('/admin/invoices');
  await page.getByLabel('Facility').click();
  await page.getByPlaceholder('Search facilities…').fill('E2E General');
  await page.getByRole('option', { name: /^E2E General Hospital/ }).click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  // The transfer is recorded as the bank statement shows it: reference and amount, with the
  // date (today) and the payer (the hospital) already filled in. Not the card's button.
  const dialog = page.getByRole('dialog', { name: /^Record payment of / });
  await dialog.getByLabel('Bank reference for the transfer').fill('E2E-TRANSFER-0001');
  await dialog.getByLabel('Amount received (₦)').fill(gross.replace(/[₦,]/g, ''));
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expectToast(page, 'Recorded as paid');

  await page.context().clearCookies();
  await signIn(page, world().scheduler);
  await page.goto('/facility/invoices');
  await expect(figure(page, 'Outstanding')).toHaveText('₦0.00');
  await expect(figure(page, 'Paid')).toHaveText(gross);
});

test('the nurse sees what she is owed', async ({ page }) => {
  await signIn(page, world().practitioner);
  await page.goto('/practitioner/earnings');

  // No platform fee is set yet (stage-3 gate 3.1), so she earns the gross.
  await expect(figure(page, 'Owed to you')).toHaveText(gross);
  await expect(page.getByText('No payments yet')).toBeVisible();
});

test('finance pays her, and her earnings say so', async ({ page }) => {
  await signIn(page, world().admin);
  await confirmPassword(page);
  await page.goto('/admin/payouts');
  await page.getByLabel('Search by name or number').fill(world().practitioner.fullName);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button').filter({ hasText: world().practitioner.fullName }).first().click();

  await page.getByRole('button', { name: 'Prepare', exact: true }).click();
  await expectToast(page, 'Prepared');
  await page.getByRole('button', { name: `Release ${gross}` }).click();
  await expectToast(page, 'Released to the gateway');

  await page.context().clearCookies();
  await signIn(page, world().practitioner);
  await page.goto('/practitioner/earnings');
  await expect(figure(page, 'Owed to you')).toHaveText('₦0.00');
  await expect(figure(page, 'Paid to you')).toHaveText(gross);
  await expect(card(page, /Received \d/).filter({ hasText: gross })).toBeVisible();
});
