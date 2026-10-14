import { expect, test } from '@playwright/test';
import { latestOtp } from './support/otp';
import { world } from './support/world';

/**
 * Getting in: signing up, signing in, and being kept out.
 *
 * This is the one file that drives the sign-in form. Every other journey
 * signs in through the API (support/session.ts) and starts on the page it is
 * actually about.
 */

test('a practitioner signs up in three steps and lands in their own console', async ({ page }) => {
  // A number nobody has: the run's own clock, inside the block e2e-world owns.
  const suffix = String(Date.now()).slice(-5);
  const phone = `+23480395${suffix}`;
  const startedAt = new Date();

  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();

  await page.getByLabel('Full name').fill('Chika Testsignup');
  await page.getByLabel('Phone number').fill(phone);
  // Tagged, so the next run's world builder clears this account away.
  await page.getByLabel(/^Email/).fill(`chika.${suffix}@e2e.medilink.test`);
  await page.getByRole('checkbox', { name: /privacy notice/ }).check();
  await page.getByRole('button', { name: 'Send me a code' }).click();

  await expect(page.getByText('Confirm your number', { exact: true })).toBeVisible();
  const code = await latestOtp(phone, startedAt);
  await page.getByLabel('The 6-digit code').fill(code);
  await page.getByRole('button', { name: 'Confirm my number' }).click();

  await expect(page.getByText('Set a password', { exact: true })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(world().password);
  await page.getByLabel('Confirm password').fill(world().password);
  // Consent to be shown to hospitals is asked with the account, and the
  // button waits for it.
  await expect(page.getByRole('button', { name: 'Create my account' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Show my verified credentials/ }).check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  // The practitioner grant arrives through the outbox worker; the form waits
  // for it, so landing with a working sidebar proves the worker ran too.
  await expect(page).toHaveURL(/\/practitioner$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Hello, Chika' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My profile' })).toBeVisible();
  // A brand-new account has nothing set up, so the overview offers the way in.
  await expect(page.getByRole('link', { name: /Start setup/ })).toBeVisible();
});

test('a wrong code is refused and the account stays unverified', async ({ page }) => {
  const suffix = String(Date.now() + 7).slice(-5);
  const phone = `+23480396${suffix}`;

  await page.goto('/register');
  await page.getByLabel('Full name').fill('Dayo Testwrongcode');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByLabel(/^Email/).fill(`dayo.${suffix}@e2e.medilink.test`);
  await page.getByRole('checkbox', { name: /privacy notice/ }).check();
  await page.getByRole('button', { name: 'Send me a code' }).click();

  await expect(page.getByText('Confirm your number', { exact: true })).toBeVisible();
  await page.getByLabel('The 6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Confirm my number' }).click();

  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByText('Confirm your number', { exact: true })).toBeVisible();
});

for (const [who, console_] of [
  ['admin', '/admin'],
  ['scheduler', '/facility'],
  ['practitioner', '/practitioner'],
] as const) {
  test(`the ${who} signs in through the form and opens ${console_}`, async ({ page }) => {
    const person = world()[who];

    await page.goto('/login');
    await page.getByLabel('Phone number').fill(person.phone);
    await page.getByLabel('Password').fill(world().password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Decided by the grants on the account, not by the link followed.
    await expect(page).toHaveURL(new RegExp(`${console_}$`), { timeout: 30_000 });
  });
}

test('a wrong password is refused with a reason, and nobody is signed in', async ({ page }) => {
  // Not a journey actor: enough wrong guesses lock an account, and locking
  // one the other files sign in as would fail them for this file's reasons.
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(world().pendingOwner.phone);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  const session = await page.request.get('/api/v1/auth/session');
  expect(session.status()).toBe(401);
});

test('a signed-out visitor who opens a console is sent to sign in', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
});

test('a practitioner cannot open the operations console', async ({ page }) => {
  await page.request.post('/api/v1/auth/login', {
    data: { phone: world().practitioner.phone, password: world().password },
  });

  // The page is a courtesy; the API is the control. Asking it directly is the
  // check that matters.
  const response = await page.request.get('/api/v1/audit?scopeType=PLATFORM');
  expect(response.status()).toBe(403);
});
