import { expect, test } from '@playwright/test';
import { formatWhen } from '../../src/components/app/format';
import { signIn, switchTo } from './support/session';
import { card, choose, expectToast, lagosLocal, section } from './support/ui';
import { initialsOf } from '../../src/lib/names';
import { world } from './support/world';

/**
 * A shift, from nothing to somebody booked on it.
 *
 * The scheduler publishes it, asks the engine who could work it, offers it to
 * the nurse the engine ranked; she accepts; the scheduler confirms her. Four
 * screens, two people, and the order matters, so the file runs as one story.
 */
test.describe.configure({ mode: 'serial' });

const DAY = 24 * 60 * 60 * 1000;

// Two days out, mid-morning in Abuja: clear of both of the nurse's other
// shifts in the world, whatever time of day the run starts.
const startsAt = new Date(Date.now() + 2 * DAY);
startsAt.setUTCHours(8, 0, 0, 0); // 09:00 WAT
const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);

/** Written on the shift so this run can find its own among the demo data. */
const marker = `E2E staffing run ${Date.now()}`;

let shiftPath = '';

test('the scheduler publishes a shift', async ({ page }) => {
  await signIn(page, world().scheduler);
  await page.goto('/facility/shifts');

  await page.getByRole('button', { name: 'Publish a shift' }).click();
  const dialog = page.getByRole('dialog');
  await choose(dialog, 'Profession', 'Nurse / Midwife');
  await dialog.getByLabel('Starts', { exact: true }).fill(lagosLocal(startsAt));
  await dialog.getByLabel('Ends', { exact: true }).fill(lagosLocal(endsAt));
  await dialog.getByLabel('Notes for the practitioner (optional)').fill(marker);
  // What the shift comes to is worked out by the server, with the facility's own allowances, and
  // said before anybody commits: the figure, and what it leaves out.
  const estimate = dialog.getByTestId('shift-estimate');
  await expect(estimate).toContainText(/This shift would cost about ₦/);
  await expect(estimate).toContainText(/invoiced from the approved timesheet/);
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  await expectToast(page, 'Shift published');
  await expect(dialog).toBeHidden();

  // Found again by what was written on it, which is how a scheduler with a
  // full board finds anything.
  await page.getByLabel('Search notes').fill(marker);
  await page.getByRole('button', { name: 'Search' }).click();
  const findStaff = page.getByRole('link', { name: 'Find staff' });
  await expect(findStaff).toHaveCount(1);
  await findStaff.click();
  await expect(page).toHaveURL(/\/facility\/shifts\/[0-9a-f-]{36}$/);
  shiftPath = new URL(page.url()).pathname;
});

test('the engine ranks the cleared nurse and the scheduler offers her the shift', async ({ page }) => {
  const nurse = world().practitioner;
  await signIn(page, world().scheduler);
  await page.goto(shiftPath);

  // The facility is shown what the shift comes to before it offers it to anybody.
  await expect(page.getByTestId('shift-estimate')).toContainText(/This shift would cost about ₦/);

  await page.getByRole('button', { name: 'Find candidates' }).click();
  await expectToast(page, /practitioners are eligible/);

  // A ranking changes nothing until a person picks from it. A match shows
  // initials, not names, so the card is found by the person it stands for.
  const candidate = page.getByTestId(`candidate-${nurse.id}`);
  await expect(candidate).toBeVisible();
  await candidate.click();
  await expect(candidate.getByText('Selected')).toBeVisible();

  await page.getByRole('button', { name: 'Offer to 1 selected' }).click();
  await expectToast(page, 'Offered to 1 practitioner');
  // Offered, not yet accepted: still initials.
  await expect(section(page, 'Offered').getByText(initialsOf(nurse.fullName))).toBeVisible();
});

test('the nurse accepts the offer from her own console', async ({ page }) => {
  await signIn(page, world().practitioner);
  await page.goto('/practitioner/offers');

  const offer = card(page, world().facility.name).filter({
    has: page.getByRole('button', { name: 'Accept' }),
  });
  await expect(offer).toHaveCount(1);
  // The terms are on the offer itself, not behind it.
  await expect(offer.getByText('₦5,000.00/hour')).toBeVisible();
  // And what it comes to, in words, before she says yes.
  await expect(offer.getByTestId('shift-estimate')).toContainText(/You would be paid about ₦/);
  await offer.getByRole('button', { name: 'Accept' }).click();

  await expectToast(page, 'Accepted — the facility still has to confirm you');
  await expect(page.getByText('Already answered')).toBeVisible();
});

test('the scheduler confirms her, and she sees the booking', async ({ page }) => {
  const nurse = world().practitioner;
  await signIn(page, world().scheduler);
  await page.goto(shiftPath);

  // Accepting is not being booked. The facility still decides.
  const ready = section(page, 'Ready to confirm');
  await expect(ready.getByText(nurse.fullName)).toBeVisible();
  await ready.getByRole('button', { name: 'Confirm' }).click();

  await expectToast(page, 'Practitioner confirmed onto the shift');
  await expect(section(page, 'Confirmed').getByText(nurse.fullName)).toBeVisible();

  await switchTo(page, nurse);
  await page.goto('/practitioner/shifts');
  await expect(card(page, world().facility.name).filter({ hasText: formatWhen(startsAt) })).toBeVisible();
});
