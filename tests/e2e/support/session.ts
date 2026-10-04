import { expect, type Page } from '@playwright/test';
import { world, type Person } from './world';

/**
 * Signs in through the API rather than the form.
 *
 * `page.request` shares the browser context's cookie jar, so the session
 * cookie the route sets is the one the page then sends. The form itself is
 * covered once, in auth.spec.ts; every other journey starting by typing a
 * password would spend its time proving the same thing again.
 */
export async function signIn(page: Page, person: Person): Promise<void> {
  const response = await page.request.post('/api/v1/auth/login', {
    data: { phone: person.phone, password: world().password },
  });
  expect(response.status(), `signing in as ${person.fullName}`).toBe(200);
}

/** Signs out by dropping the cookie, so the next actor starts clean. */
export async function signOut(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/** Becomes somebody else in the same page. */
export async function switchTo(page: Page, person: Person): Promise<void> {
  await signOut(page);
  await signIn(page, person);
}
