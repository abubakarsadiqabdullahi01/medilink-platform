import { expect, test, type Page } from '@playwright/test';
import { signIn, switchTo } from './support/session';
import { expectToast } from './support/ui';
import { world } from './support/world';

/**
 * Telling Medilink what to improve, and hearing back (M18).
 *
 * The form promised "The Medilink team reads every suggestion and replies to it". The reply was
 * written on the operations screen and nothing carried it back: the author could not see where
 * their suggestion stood and was never told it had been answered.
 */
test.describe.configure({ mode: 'serial' });

// Digits kept short: nothing here screens for them, but a run of nine looks like somebody's number.
const marker = `E2E suggestion ${String(Date.now()).slice(-6)}`;
const ANSWER = 'We have added a reminder the evening before each shift, as you asked.';
let suggestionId = '';

async function openYours(page: Page): Promise<void> {
  await page.goto('/practitioner');
  await page.getByRole('button', { name: world().practitioner.fullName }).click();
  await page.getByRole('menuitem', { name: 'Send a suggestion' }).click();
  await page.getByRole('tab', { name: 'Yours' }).click();
}

test('a practitioner sends a suggestion and can see that it was received', async ({ page }) => {
  await signIn(page, world().practitioner);
  await page.goto('/practitioner');
  await page.getByRole('button', { name: world().practitioner.fullName }).click();
  await page.getByRole('menuitem', { name: 'Send a suggestion' }).click();
  await page.getByLabel('Your suggestion').fill(`${marker}: please remind me the evening before a shift.`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expectToast(page, 'Thank you');

  await openYours(page);
  const mine = page.getByRole('listitem').filter({ hasText: marker });
  await expect(mine).toBeVisible();
  await expect(mine.getByText('Received')).toBeVisible();
  await expect(mine.getByText(/we have it/i)).toBeVisible();

  const body = (await (await page.request.get('/api/v1/me/suggestions')).json()) as {
    suggestions: { id: string; body: string }[];
  };
  suggestionId = body.suggestions.find((s) => s.body.includes(marker))!.id;
  expect(suggestionId).not.toBe('');
});

test('an administrator answers it', async ({ page }) => {
  await signIn(page, world().admin);
  await page.goto('/admin/suggestions');
  await expect(page.getByText(marker).first()).toBeVisible();

  const response = await page.request.post(`/api/v1/suggestions/${suggestionId}/triage`, {
    data: { status: 'DONE', response: ANSWER },
  });
  expect(response.status()).toBe(200);
});

test('the practitioner reads the answer, and is told it was answered', async ({ page }) => {
  await switchTo(page, world().practitioner);

  await openYours(page);
  const mine = page.getByRole('listitem').filter({ hasText: marker });
  await expect(mine.getByText('Done', { exact: true })).toBeVisible();
  await expect(mine.getByText(ANSWER)).toBeVisible();

  // The worker texts them and the same message is in the app's inbox.
  await expect
    .poll(
      async () => {
        const inbox = (await (await page.request.get('/api/v1/me/notifications?limit=20')).json()) as {
          items: { body: string }[];
        };
        return inbox.items.map((item) => item.body).join('\n');
      },
      { timeout: 60_000 },
    )
    .toContain('Your suggestion to Medilink is done');
});
