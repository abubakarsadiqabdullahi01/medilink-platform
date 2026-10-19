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

/** A 1x1 PNG: small enough to inline, real enough for an <img> to draw. */
const SLIP = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Unique per run: one folio belongs to one practitioner, enforced by the database. */
const FOLIO = `NMCN/E2E/${Date.now() % 1_000_000}`;

/** `option` is a pattern because an option's accessible name carries its hint too. */
async function pickFromCombobox(page: Page, label: string, search: string, option: RegExp) {
  await page.getByLabel(label).click();
  // The newest popover is the last one in the document; the one before it
  // can still be animating closed.
  await page
    .getByPlaceholder(/^Search /)
    .last()
    .fill(search);
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
  // Creating the profile is step one of the setup wizard, so it moves on by
  // itself to the next thing the newcomer has to say.
  await expect(page.getByRole('heading', { name: 'When can you work?' })).toBeVisible();
});

test('the overview offers the way back into setup', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner');

  await page.getByRole('link', { name: /Continue setup/ }).click();
  await expect(page).toHaveURL(/\/practitioner\/profile$/);
  // Opened at the first thing not yet done: the details are, availability is not.
  await expect(page.getByRole('heading', { name: 'When can you work?' })).toBeVisible();
});

test('the review step says what is missing and takes you to it', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/profile');

  // Straight to the end, though availability has not been set.
  await page.getByRole('button', { name: /Review and submit/ }).click();
  await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeDisabled();

  // The missing item is a button to where it is fixed, not a paragraph.
  await page.getByRole('button', { name: /Set availability/ }).click();
  await expect(page.getByRole('heading', { name: 'When can you work?' })).toBeVisible();
});

test('the old addresses land on the tab that replaced them', async ({ page }) => {
  await signIn(page, world().newcomer);

  await page.goto('/practitioner/credentials');
  await expect(page).toHaveURL(/\/practitioner\/profile\?tab=credentials$/);
  await page.goto('/practitioner/availability');
  await expect(page).toHaveURL(/tab=availability$/);
  await page.goto('/practitioner/privacy');
  await expect(page).toHaveURL(/tab=privacy$/);
});

test('submits a NIN with a photograph of the slip, and is stopped on a malformed number', async ({
  page,
}) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/profile?tab=credentials');

  await choose(page, 'Type', 'National Identification Number');
  // By id: the dropdown that was just used is still closing, and its option
  // carries the same words as this field's label.
  const number = page.locator('#submit-reference');

  // Stopped before it is sent, rather than refused later by an officer.
  await number.fill('1234');
  await expect(page.getByText('A National Identification Number is 11 digits.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();

  await number.fill('99000000022');
  // The number alone is not enough while nothing can check it automatically:
  // an officer needs a photograph to read it against.
  await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await page.locator('input[type=file]').setInputFiles({
    name: 'nin-slip.png',
    mimeType: 'image/png',
    buffer: SLIP,
  });
  await expect(page.getByText('nin-slip.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  await expectToast(page, 'Submitted for review');
  await expect(card(page, 'National Identification Number').getByText(/pending/i)).toBeVisible();
});

test('submits a practising licence with a photograph of it', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/profile?tab=credentials');

  await choose(page, 'Type', 'MDCN Annual Practising Licence');
  await page.locator('#submit-reference').fill(FOLIO);
  await page.locator('input[type=file]').setInputFiles({
    name: 'licence.png',
    mimeType: 'image/png',
    buffer: SLIP,
  });
  await page.getByRole('button', { name: 'Submit', exact: true }).click();

  await expectToast(page, 'Submitted for review');
  await expect(card(page, 'MDCN Annual Practising Licence').getByText(/pending/i)).toBeVisible();
});

test('submits one checked by eye, uploading the document to storage', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/profile?tab=credentials');

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
  await expect(
    card(page, 'Professional Indemnity Cover').getByText('Document attached'),
  ).toBeVisible();
});

test('a type already submitted cannot be picked again', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/profile?tab=credentials');

  await page.getByRole('combobox', { name: /^Type/ }).click();
  // Greyed out and saying why, rather than selectable and refused on submit.
  const option = page.getByRole('option', { name: /National Identification Number/ });
  await expect(option).toHaveAttribute('aria-disabled', 'true');
  await expect(option).toContainText(/awaiting review/);
});

test('the newcomer finishes the application and submits it for approval', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/profile');

  // Opens on availability: the details are in, this is not.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Monday').first()).toBeVisible();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();

  await expect(page.getByText('Everything is in. Ready to submit.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expectToast(page, 'Submitted for approval');
  await expect(page.getByText('Submitted — waiting for approval')).toBeVisible();

  // The overview now says it is somebody else's turn, and offers nothing to do.
  await page.goto('/practitioner');
  await expect(page.getByText('Waiting for approval').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Continue setup|Start setup/ })).toHaveCount(0);
});

test('the officer finds them under waiting for approval, and not under not submitted', async ({
  page,
}) => {
  await signIn(page, world().admin);
  await page.goto('/admin/practitioners');

  // Opens on the queue, because that is the work.
  await expect(page.getByRole('tab', { name: 'Waiting for approval' })).toHaveAttribute(
    'data-state',
    'active',
  );
  await page.getByLabel('Search by name or number').fill(world().newcomer.fullName);
  await page.getByRole('button', { name: 'Search' }).click();
  // One row per practitioner, saying when they asked to be reviewed.
  await expect(page.getByRole('row').filter({ hasText: world().newcomer.fullName })).toContainText(
    /Submitted/,
  );

  await page.getByRole('tab', { name: 'Not submitted yet' }).click();
  await expect(page.getByRole('row').filter({ hasText: world().newcomer.fullName })).toHaveCount(0);
});

test('an administrator confirms the NIN and licence from what was sent, and asks for more on the indemnity', async ({
  page,
}) => {
  await signIn(page, world().admin);
  await page.goto('/admin/credentials');
  await page.getByLabel('Search by practitioner').fill(world().newcomer.fullName);
  await page.getByRole('button', { name: 'Search' }).click();

  // Each row has one next step, "Review", which opens the submission beside the queue.
  const name = world().newcomer.fullName;
  await page
    .getByRole('button', { name: `Review Professional Indemnity Cover for ${name}` })
    .click();
  const panel = page.getByRole('dialog', { name: 'Review this submission' });

  // The reviewer looks at the document itself, fetched on a short-lived URL.
  await panel.getByRole('button', { name: 'View document' }).click();
  const viewer = page.getByRole('dialog', { name: 'Professional Indemnity Cover' });
  await expect(viewer).toBeVisible();
  // The document itself, not just a dialog with a title: this used to open empty
  // because the viewer read `url` from a response that calls it `downloadUrl`.
  await expect(viewer.locator('iframe, img')).toBeVisible();
  // Closed with its button: an embedded PDF keeps the keyboard focus, so Escape
  // never reaches the dialog — which is what a person would find too.
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toBeHidden();

  // Asking for more needs a reason, because the reason is the only thing
  // that tells the practitioner what to fix.
  await expect(panel.getByRole('button', { name: /^Ask for more/ })).toBeDisabled();
  await panel
    .getByLabel(/^Reason/)
    .fill('The insurer and the policy period are not legible. Please upload the schedule page.');
  await panel.getByRole('button', { name: /^Ask for more/ }).click();

  // And it asks before it acts, saying what will happen and that it is not final.
  const ask = page.getByRole('dialog', { name: 'Ask for more information' });
  await expect(ask.getByText('Not final.')).toBeVisible();
  await ask.getByRole('button', { name: 'Ask for more information' }).click();
  await expectToast(page, 'More information requested');

  // A NIN is not approved in place: approving it has to record the identity,
  // so it is confirmed on the practitioner's page, beside the photograph.
  await page
    .getByRole('button', { name: `Review National Identification Number for ${name}` })
    .click();
  const ninPanel = page.getByRole('dialog', { name: 'Review this submission' });
  await expect(ninPanel.getByRole('button', { name: /^Verify/ })).toHaveCount(0);
  await ninPanel.getByRole('link', { name: /^Review and confirm/ }).click();
  await expect(page).toHaveURL(/\/admin\/practitioners\?user=/);

  const identity = card(page, 'Identity —');
  // Not loaded until the officer asks: opening an identity document is an access
  // that is recorded, and should be because somebody chose to look.
  await expect(page.getByRole('img', { name: 'NIN slip' })).toHaveCount(0);
  await identity.getByRole('button', { name: 'Show the photograph' }).click();
  await expect(page.getByRole('img', { name: 'NIN slip' })).toBeVisible();

  // The number is what they sent; the officer says only what they read.
  await expect(identity.getByText('99000000022')).toBeVisible();
  await expect(identity.getByRole('button', { name: 'Confirm identity' })).toBeDisabled();
  await identity.getByRole('button', { name: 'Matches the account' }).click();
  await identity.getByRole('button', { name: 'Confirm identity' }).click();
  // Recording an identity keeps only the last four digits, so it asks first.
  await page
    .getByRole('dialog', { name: 'Record this identity' })
    .getByRole('button', { name: 'Confirm identity' })
    .click();
  await expectToast(page, 'Identity confirmed');

  const registration = card(page, 'Registration —');
  await registration.getByRole('button', { name: 'Show the photograph' }).click();
  await expect(registration.getByText(FOLIO)).toBeVisible();
  await expect(registration.getByRole('button', { name: 'Confirm registration' })).toBeDisabled();
  await choose(registration, 'What the licence shows', 'Active');
  await registration.getByLabel(/^Expiry date on the licence/).fill('2027-06-30');
  await registration.getByRole('button', { name: 'Confirm registration' }).click();
  await page
    .getByRole('dialog', { name: 'Record this registration' })
    .getByRole('button', { name: 'Confirm registration' })
    .click();
  await expectToast(page, 'Registration confirmed');
});

test('the practitioner sees the verification and reads the reviewer’s note', async ({ page }) => {
  await signIn(page, world().newcomer);
  await page.goto('/practitioner/profile?tab=credentials');

  // The badge: the card says the word again in its next-step line and in its history.
  await expect(
    card(page, 'National Identification Number').getByText('Verified', { exact: true }).first(),
  ).toBeVisible();
  // The number has done its job: only the tail is kept, even from its owner.
  await expect(card(page, 'National Identification Number').getByText('*******0022')).toBeVisible();
  await expect(
    card(page, 'Professional Indemnity Cover').getByText(/The insurer and the policy period/),
  ).toBeVisible();

  // And what was recorded from what they sent is on their own record.
  await page.goto('/practitioner/profile?tab=profile');
  await expect(page.getByText(/NIN ending 0022/)).toBeVisible();
  await expect(page.getByText(`NMCN ${FOLIO}`)).toBeVisible();
});
