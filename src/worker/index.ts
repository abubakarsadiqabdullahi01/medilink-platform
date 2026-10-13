import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { handlers } from './handlers';
import { runOnce } from './processor';
import { jobs } from './jobs';
import { runDueJobs } from './scheduler';
import { ACTIVE_POLL_MS, jobsCheckDue, nextOutboxDelay } from './polling';

/**
 * The background process: the outbox worker and the scheduled-job runner.
 *
 * Both live here rather than in separate processes because neither is
 * expensive when idle, and one process is one thing to deploy, watch and
 * restart. The behaviour of each lives in ./processor.ts and ./scheduler.ts
 * where it can be tested; this file decides only when to run a pass.
 */
/** After an error; the loop must not spin on a failing database. */
const ERROR_BACKOFF_MS = ACTIVE_POLL_MS;

let running = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loop() {
  logger.info('worker started');

  let idlePasses = 0;
  let jobsCheckedAt: number | null = null;

  while (running) {
    try {
      const pass = await runOnce({ handlers });

      // Scheduled jobs are hourly or daily, so the table is looked at every
      // thirty seconds rather than every pass; see ./polling.ts.
      let swept = 0;
      if (jobsCheckDue(jobsCheckedAt, Date.now())) {
        jobsCheckedAt = Date.now();
        swept = (await runDueJobs({ handlers: jobs })).claimed;
      }

      // Only idle when there was nothing to do at all; a full outbox batch
      // usually means more is waiting, and sleeping on it adds latency.
      if (pass.claimed === 0 && swept === 0) {
        idlePasses += 1;
        await sleep(nextOutboxDelay(idlePasses));
      } else {
        idlePasses = 0;
      }
    } catch (error) {
      logger.error('worker loop error', { error: String(error) });
      await sleep(ERROR_BACKOFF_MS);
    }
  }

  await prisma.$disconnect();
  logger.info('worker stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

void loop();
