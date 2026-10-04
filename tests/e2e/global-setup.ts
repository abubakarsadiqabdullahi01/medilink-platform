import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
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
 *   anything else         E2E_WORLD_COMMAND="…"
 *
 * Both write into the repository (the web container bind-mounts it at /app),
 * which is how the result reaches the test workers.
 */
const DEFAULT_COMMAND = process.env.CI
  ? 'pnpm tsx scripts/e2e-world.ts'
  : 'docker compose exec -T web pnpm tsx scripts/e2e-world.ts';

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

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
  await waitForApp(baseURL);

  // A fresh outbox each run, so a code from yesterday's run can never be
  // mistaken for today's.
  mkdirSync('.e2e', { recursive: true });
  rmSync(SMS_OUTBOX, { force: true });

  const command = process.env.E2E_WORLD_COMMAND ?? DEFAULT_COMMAND;
  execSync(command, { stdio: ['ignore', 'ignore', 'inherit'], timeout: 180_000 });

  const { readFileSync } = await import('node:fs');
  const world = JSON.parse(readFileSync(WORLD_FILE, 'utf8')) as World;
  if (world.workerLagSeconds > MAX_WORKER_LAG_SECONDS) {
    throw new Error(
      `The outbox has had an unclaimed event for ${world.workerLagSeconds}s. ` +
        'Several journeys wait on the worker; start it first ' +
        '(`docker compose up -d worker`, or `pnpm worker` on CI).',
    );
  }
}
