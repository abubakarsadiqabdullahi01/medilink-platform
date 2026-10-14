import { expect, type Locator, type Page } from '@playwright/test';
import { world } from './world';

/**
 * The card on the page that mentions `text`.
 *
 * The consoles render every queue entry as a shadcn Card, and the demo data a
 * local run shares the database with means a queue is never empty — so a
 * journey finds its own row by a name only it uses, never by position.
 */
export function card(page: Page, text: string | RegExp): Locator {
  return page.locator('div.bg-card').filter({ hasText: text });
}

/**
 * The card whose title is exactly `title` — "Offered", "Confirmed".
 *
 * `card()` matches a substring anywhere in the card, case-insensitively, and
 * "Nothing is offered until you click" is in the card next door.
 */
export function section(page: Page, title: string): Locator {
  return page.locator('div.bg-card').filter({ has: page.getByText(title, { exact: true }) });
}

/**
 * Chooses an option in a Radix select by the label written above it.
 *
 * The consoles label selects with a sibling `<Label>` rather than `htmlFor`,
 * because a Radix trigger is a button and not a form control, so the
 * accessible-name route does not reach it. The field wrapper does.
 */
export async function choose(scope: Page | Locator, label: string, option: string | RegExp) {
  // The listbox renders in a portal at the end of <body>, outside any scope.
  const page = 'goto' in scope ? scope : scope.page();
  const field = scope
    .locator('div.space-y-1\\.5')
    .filter({ has: page.getByText(label, { exact: true }) });
  await field.getByRole('combobox').first().click();
  await page.getByRole('option', { name: option }).first().click();
}

/**
 * A sonner toast with this title. Toasts are the consoles' only success signal.
 *
 * Longer than the default wait, because a toast waits on the mutation's
 * round trip, and under `next dev` the first request to an API route
 * compiles it — a minute is not unheard of straight after a restart.
 */
export async function expectToast(page: Page, title: string | RegExp): Promise<void> {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: title }).first()).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * Waits for every toast to go.
 *
 * A toast sits at the bottom right and pauses its own timer while the mouse is over it. A button
 * that Playwright has to scroll into view lands at the bottom edge, under the toast; the click
 * moves the mouse onto the toast, the toast then never goes, and the click is intercepted for ever
 * (money.spec.ts, "Issue it"). Wait with the mouse elsewhere, and the click lands.
 */
export async function toastsGone(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Answers the "Confirm it is you" dialog a money act opens, with the password the world
 * signs people in with. The act that opened it then carries on by itself.
 */
export async function confirmItIsYou(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Confirm it is you' });
  await dialog.getByLabel('Password').fill(world().password);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
}

/**
 * `YYYY-MM-DDTHH:mm` in Lagos time, which is what a datetime-local input
 * takes. The browser runs in Africa/Lagos (playwright.config.ts), so this is
 * the wall-clock time a person in Abuja would type.
 */
export function lagosLocal(at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Reloads until `check` passes.
 *
 * For state that arrives through the outbox worker — a grant, a computed
 * timesheet — which the page has no way to be told about.
 */
export async function eventually(page: Page, check: () => Promise<void>, timeoutMs = 30_000) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: timeoutMs, intervals: [1_000, 2_000, 3_000] });
}
