import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { handlers } from './handlers';
import { runOnce } from './processor';
import { jobs } from './jobs';
import { runDueJobs } from './scheduler';

/**
 * The background process: the outbox worker and the scheduled-job runner.
 *
 * Both live here rather than in separate processes because neither is
 * expensive when idle, and one process is one thing to deploy, watch and
 * restart. The behaviour of each lives in ./processor.ts and ./scheduler.ts
 * where it can be tested; this file decides only when to run a pass.
 */
const IDLE_MS = 2000;

let running = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loop() {
  logger.info('worker started');

  while (running) {
    try {
      const pass = await runOnce({ handlers });
      const swept = await runDueJobs({ handlers: jobs });

      // Only idle when there was nothing to do at all; a full outbox batch
      // usually means more is waiting, and sleeping on it adds latency.
      if (pass.claimed === 0 && swept.claimed === 0) await sleep(IDLE_MS);
    } catch (error) {
      logger.error('worker loop error', { error: String(error) });
      await sleep(IDLE_MS);
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
