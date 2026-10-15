import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { signIn } from './support/session';
import { confirmItIsYou } from './support/ui';
import { world } from './support/world';

/**
 * A member of hospital staff asking what the platform holds about them (M17-03, AUD-08).
 *
 * The download lived on a practitioner's privacy page and the route behind it needed a
 * practitioner permission, so a hospital's scheduler had no way to ask at all. It is now in
 * the account menu every signed-in person has, it asks for the password again because it
 * hands over everything at once, and the file that arrives is theirs and nobody else's.
 */
test('a hospital scheduler downloads their own data, after confirming it is them', async ({ page }) => {
  await signIn(page, world().scheduler);
  await page.goto('/facility');

  await page.getByRole('button', { name: world().scheduler.fullName }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download my data' }).click();

  // A session that has only just signed in has not confirmed its password, so it is asked.
  await confirmItIsYou(page);
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/^medilink-my-data-\d{4}-\d{2}-\d{2}\.json$/);

  const text = await readFile((await file.path())!, 'utf8');
  const data = JSON.parse(text) as {
    account: { id: string; fullName: string };
    roles: { role: string }[];
    sessions: unknown[];
    notIncluded: Record<string, string>;
  };

  expect(data.account).toMatchObject({ id: world().scheduler.id, fullName: world().scheduler.fullName });
  // What a hospital's scheduler has, as opposed to a practitioner: a role at the facility, a
  // session, and the reasons for what is left out, written in the file for whoever reads it.
  expect(data.roles.length).toBeGreaterThan(0);
  expect(data.sessions.length).toBeGreaterThan(0);
  expect(Object.keys(data.notIncluded)).toContain('auditTrail');
  // Somebody else on the platform, who shares a hospital and a shift with them, is not in it.
  expect(text).not.toContain(world().practitioner.phone);
  expect(text).not.toContain(world().practitioner.id);
  expect(text).not.toMatch(/tokenHash|pushToken/);
});
