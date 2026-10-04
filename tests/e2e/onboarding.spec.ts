import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/session';
import { card, choose, expectToast } from './support/ui';
import { world } from './support/world';

/**
 * A practitioner who has just signed up, getting as far as the platform lets
 * them on their own: a profile, a credential checked against a register, and
 * one checked by eye — uploaded straight to storage through a signed URL.
 * Then the other side: an administrator verifies one and asks for more on
 * the other, and the practitioner reads what they said.
 */
test.describe.configure({ mode: 'serial' });

/** The smallest file storage and the upload control will both accept as a PDF. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

/** `option` is a pattern because an option's accessible name carries its hint too. */
async function pickFromCombobox(page: Page, label: string, search: string, option: RegExp) {
  await page.getByLabel(label).click();
  // The newest popover is the last one in the document; the one before it
  // can still be animating closed.
  await page.getByPlaceholder(/^Search /).last().fill(search);
  await page.getByRole('option', { name: option }).first().click();
}

test('the newcomer builds a profile', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/profile');

  await choose(page, 'Profession', 'Nurse / Midwife');
  await page.getByLabel('Years of experience').fill('3');
  // 37 states and 774 areas: searchable, because nobody scrolls that far.
  await pickFromCombobox(page, 'State you live in', 'Federal', /^Federal Capital Territory/);
  await pickFromCombobox(page, 'Local government area', 'Abuja', /^Abuja Municipal/);
  await page.getByRole('button', { name: 'Create profile' }).click();

  await expectToast(page, 'Saved');
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
});

test('submits a credential checked against a register, by number alone', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/credentials');

  await choose(page, 'Type', 'National Identification Number');
  // The form asks for what this type needs — a number, not a scan.
  await page.getByLabel('Reference or licence number').fill('99000000022');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  await expectToast(page, 'Submitted for review');
  await expect(card(page, 'National Identification Number').getByText(/pending/i)).toBeVisible();
});

test('submits one checked by eye, uploading the document to storage', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/credentials');

  await choose(page, 'Type', 'Professional Indemnity Cover');
  await page.locator('input[type=file]').setInputFiles({
    name: 'indemnity-2026.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  // The file went browser → storage on a signed URL; the app never held it.
  await expect(page.getByText('indemnity-2026.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  await expectToast(page, 'Submitted for review');
  await expect(card(page, 'Professional Indemnity Cover').getByText('Document attached')).toBeVisible();
});

test('an administrator verifies one and asks for more on the other', async ({ page }) => {
  await signIn(page, world().admin);
  await page.goto('/admin/credentials');
  await page.getByLabel('Search by practitioner').fill(world().newcomer.fullName);
  await page.getByRole('button', { name: 'Search' }).click();

  const nin = card(page, world().newcomer.fullName).filter({ hasText: 'National Identification Number' });
  await nin.getByRole('button', { name: 'Verify' }).click();
  await expectToast(page, 'Credential verified');

  const indemnity = card(page, world().newcomer.fullName).filter({
    hasText: 'Professional Indemnity Cover',
  });
  // The reviewer looks at the document itself, fetched on a short-lived URL.
  await indemnity.getByRole('button', { name: 'View document' }).click();
  await expect(page.getByRole('dialog', { name: 'Professional Indemnity Cover' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Asking for more needs a reason, because the reason is the only thing
  // that tells the practitioner what to fix.
  await expect(indemnity.getByRole('button', { name: 'Ask for more' })).toBeDisabled();
  await indemnity
    .getByLabel(/^Reason/)
    .fill('The insurer and the policy period are not legible. Please upload the schedule page.');
  await indemnity.getByRole('button', { name: 'Ask for more' }).click();
  await expectToast(page, 'More information requested');
});

test('the practitioner sees the verification and reads the reviewer’s note', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/credentials');

  await expect(card(page, 'National Identification Number').getByText(/verified/i)).toBeVisible();
  await expect(
    card(page, 'Professional Indemnity Cover').getByText(/The insurer and the policy period/),
  ).toBeVisible();
});
