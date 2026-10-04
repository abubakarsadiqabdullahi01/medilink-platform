import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import type { FullConfig } from '@playwright/test';
import { SMS_OUTBOX } from './support/otp';
import { WORLD_FILE, type World } from './support/world';

/**
 * Builds the world the journeys run in, once per run.
 *
 * `scripts/e2e-world.ts` needs the application's database, which is not
 * always reachable from wherever Playwright runs: on CI the app and the
 * database are both on the runner, but locally the database is inside Docker
 * — and on this project's Windows machines a native PostgreSQL also listens
 * on 5432 and answers the host first. So it runs where the app runs:
 *
 *   CI                    pnpm tsx scripts/e2e-world.ts
 *   local (the default)   docker compose exec -T web pnpm tsx scripts/e2e-world.ts
 *   E2E_SERVICE=e2e       the same, in the built `e2e` service instead
 *   anything else         E2E_WORLD_COMMAND="…"
 *
 * Both write into the repository (the web container bind-mounts it at /app),
 * which is how the result reaches the test workers.
 */
const DEFAULT_COMMAND = process.env.CI
  ? 'pnpm tsx scripts/e2e-world.ts'
  : `docker compose exec -T ${process.env.E2E_SERVICE ?? 'web'} pnpm tsx scripts/e2e-world.ts`;

/** Longer than this and the worker is not keeping up, or not running. */
const MAX_WORKER_LAG_SECONDS = 90;

async function waitForApp(baseURL: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/api/v1/health`);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`The app at ${baseURL} never became healthy (${last}). Is it running?`);
}

/**
 * Every page and API route the journeys touch, requested once before they run.
 *
 * `next dev` compiles a route on its first request, and after a restart that
 * can take longer than any sensible assertion timeout — the failures that
 * produces read as product bugs and are not. Unauthenticated requests are
 * enough: the compile happens before the 401. Against `next start` on CI this
 * is a few dozen fast requests.
 */
const NIL = '00000000-0000-0000-0000-000000000000';
const WARM = [
  '/', '/login', '/register',
  '/admin', '/admin/credentials', '/admin/facilities', '/admin/incidents', '/admin/disputes',
  '/admin/invoices', '/admin/payouts', '/facility/invoices', '/practitioner/earnings',
  '/facility', '/facility/shifts', `/facility/shifts/${NIL}`, '/facility/roster',
  '/facility/timesheets', '/facility/incidents',
  '/practitioner', '/practitioner/offers', '/practitioner/shifts', '/practitioner/timesheets',
  '/practitioner/credentials', '/practitioner/profile', '/practitioner/availability',
  '/api/v1/auth/session', '/api/v1/reference', '/api/v1/service-requests',
  `/api/v1/service-requests/${NIL}`, `/api/v1/service-requests/${NIL}/invitations`,
  `/api/v1/service-requests/${NIL}/match`, `/api/v1/service-requests/${NIL}/invite`,
  `/api/v1/service-requests/${NIL}/confirm`, `/api/v1/service-requests/${NIL}/publish`,
  '/api/v1/invitations', `/api/v1/invitations/${NIL}/respond`, '/api/v1/assignments',
  `/api/v1/assignments/${NIL}/attendance`, `/api/v1/assignments/${NIL}/attendance/token`,
  `/api/v1/assignments/${NIL}/attendance/present`, `/api/v1/assignments/${NIL}/attendance/manual`,
  `/api/v1/assignments/${NIL}/timesheet`, `/api/v1/assignments/${NIL}/timesheet/submit`,
  `/api/v1/assignments/${NIL}/timesheet/review`, `/api/v1/assignments/${NIL}/disputes`,
  '/api/v1/disputes', `/api/v1/disputes/${NIL}/review`, `/api/v1/disputes/${NIL}/resolve`,
  '/api/v1/credentials', '/api/v1/credentials/document-upload-url',
  `/api/v1/credentials/${NIL}/review`, `/api/v1/credentials/${NIL}/document-url`,
  '/api/v1/facilities', `/api/v1/facilities/${NIL}`, `/api/v1/facilities/${NIL}/verify`,
  '/api/v1/incidents', '/api/v1/incidents/queue', `/api/v1/incidents/${NIL}`,
  `/api/v1/incidents/${NIL}/review`, `/api/v1/incidents/${NIL}/close`,
  '/api/v1/practitioners/me', '/api/v1/audit', '/api/v1/invoices', '/api/v1/payouts',
  `/api/v1/invoices/${NIL}/issue`, `/api/v1/invoices/${NIL}/pay`, `/api/v1/payouts/${NIL}/release`,
  '/api/v1/practitioners',
];

async function warm(baseURL: string): Promise<void> {
  const queue = [...WARM];
  const lane = async () => {
    for (let path = queue.shift(); path; path = queue.shift()) {
      await fetch(`${baseURL}${path}`).catch(() => undefined);
    }
  };
  // A few at a time: the dev server compiles in one process either way.
  await Promise.all([lane(), lane(), lane()]);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
  await waitForApp(baseURL);
  await warm(baseURL);

  // A fresh outbox each run, so a code from yesterday's run can never be
  // mistaken for today's.
  mkdirSync('.e2e', { recursive: true });
  rmSync(SMS_OUTBOX, { force: true });

  const command = process.env.E2E_WORLD_COMMAND ?? DEFAULT_COMMAND;
  execSync(command, { stdio: ['ignore', 'ignore', 'inherit'], timeout: 180_000 });

  const world = JSON.parse(readFileSync(WORLD_FILE, 'utf8')) as World;
  if (world.workerLagSeconds > MAX_WORKER_LAG_SECONDS) {
    throw new Error(
      `The outbox has had an unclaimed event for ${world.workerLagSeconds}s. ` +
        'Several journeys wait on the worker; start it first ' +
        '(`docker compose up -d worker`, or `pnpm worker` on CI).',
    );
  }
}
