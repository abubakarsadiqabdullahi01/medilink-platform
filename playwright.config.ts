import { defineConfig, devices } from '@playwright/test';

/**
 * Browser journeys against a running app.
 *
 * The app is not started here. Locally it is the `web` container (and the
 * `worker` beside it — several journeys wait on the outbox); on CI the e2e
 * job starts `pnpm start` and `pnpm worker` itself. Global setup waits for
 * it to be healthy and builds the journeys' world (scripts/e2e-world.ts).
 *
 * One worker, files in order. The journeys share their actors — the same
 * nurse is offered, checks in and disputes across files — and each file is a
 * story told in sequence, not a set of independent cases. Parallelism would
 * buy little against a dev server that compiles each route on first visit.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // Generous, because the first visit to a route compiles it under `next dev`.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 60_000,
    // The shifts are in Nigeria and so are the people typing their times.
    timezoneId: 'Africa/Lagos',
    locale: 'en-NG',
    // CI installs Playwright's own Chromium. Locally, E2E_BROWSER_CHANNEL=chrome
    // (or msedge) uses the browser already on the machine instead.
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
  },
  projects: [
    {
      name: 'journeys',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Practitioners are mobile-first, so the mobile profile is not optional.
    // It runs its own file rather than every journey again: the journeys
    // change state, and a second pass would find every offer already taken.
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
      dependencies: ['journeys'],
    },
  ],
});
