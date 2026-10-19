import { expect, test } from '@playwright/test';
import { signIn, switchTo } from './support/session';
import { choose, expectToast, lagosLocal } from './support/ui';
import { world } from './support/world';

/**
 * The platform's own queues: a hospital waiting to be verified, and a
 * clinical incident a ward reported.
 *
 * Both end in a decision with a person's name and a reason against it, and
 * both are the kind of decision a pilot cannot run without — an unverified
 * facility cannot publish a shift, and an incident nobody closes is a record
 * nobody learned from.
 */
test.describe.configure({ mode: 'serial' });

// Six digits, not the whole timestamp: a report is refused when it holds a run of nine or more
// (it could be a patient's NIN or phone number), and this one is typed into a real report form.
const marker = `E2E incident ${String(Date.now()).slice(-6)}`;

test('an administrator verifies a facility waiting in the queue', async ({ page }) => {
  await signIn(page, world().admin);
  await page.goto('/admin/facilities');
  await page.getByLabel('Search by name or registration number').fill(world().pendingFacility.name);
  await page.getByRole('button', { name: 'Search' }).click();

  await page.getByRole('button').filter({ hasText: world().pendingFacility.name }).click();
  // Verify stays disabled until the officer says what they checked (UXO-02).
  await page.getByLabel('I opened the licence document and it is legible').check();
  await page.getByLabel(/The name and address on it are this facility/).check();
  await page.getByLabel('I checked the registration reference with whoever issued it').check();
  await page
    .getByLabel('How did you check it?')
    .fill('Phoned the issuing council and read the licence number back.');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  // Verifying lets the facility publish shifts, so it asks first.
  await page.getByRole('dialog').getByRole('button', { name: 'Verify facility' }).click();
  await expectToast(page, 'Facility verified');

  // Its owner can now act for it.
  await switchTo(page, world().pendingOwner);
  await page.goto('/facility');
  await expect(page.getByRole('heading', { name: world().pendingFacility.name })).toBeVisible();
});

test('the ward reports an incident, and cannot take it back', async ({ page }) => {
  await signIn(page, world().scheduler);
  await page.goto('/facility/incidents');

  await page.getByRole('button', { name: 'Report an incident' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report an incident' });
  await dialog
    .getByLabel('When it happened')
    .fill(lagosLocal(new Date(Date.now() - 2 * 60 * 60 * 1000)));
  await choose(dialog, 'Category', 'Equipment');
  await dialog
    .getByLabel('What happened')
    .fill(`${marker}: infusion pump alarm silenced at handover; caught on the next round.`);
  await dialog.getByRole('button', { name: 'Report it' }).click();

  await expectToast(page, 'Reported');
  await expect(page.getByText(marker).first()).toBeVisible();
});

test('an administrator takes the case and closes it with a finding', async ({ page }) => {
  await signIn(page, world().admin);
  await page.goto('/admin/incidents');
  await page.getByLabel('Search what was reported').fill(marker);
  await page.getByRole('button', { name: 'Search' }).click();

  await page.getByRole('button').filter({ hasText: marker }).click();
  await page.getByRole('button', { name: 'Take this case' }).click();
  await expectToast(page, 'Case taken');

  await choose(page, 'Outcome', /^System issue/);
  await page
    .getByLabel(/What was found/)
    .fill('Alarm volume resets on battery swap; biomedical engineering is changing the default.');
  await page.getByRole('button', { name: 'Close incident' }).click();
  await expectToast(page, 'Incident closed');
});
