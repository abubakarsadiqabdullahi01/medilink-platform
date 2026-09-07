import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { handlers } from './handlers';
import { runOnce } from './processor';

/**
 * Outbox worker. The behaviour — claiming with SKIP LOCKED, retry with
 * backoff, dead-lettering after the attempt limit — lives in ./processor.ts
 * where it can be tested. This file decides only when to run a pass and when
 * to stop.
 */
const IDLE_MS = 2000;

let running = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loop() {
  logger.info('outbox worker started');

  while (running) {
    try {
      const pass = await runOnce({ handlers });
      // Only idle when the queue is empty; a full batch usually means more is
      // waiting, and sleeping on it would add latency for no benefit.
      if (pass.claimed === 0) await sleep(IDLE_MS);
    } catch (error) {
      logger.error('worker loop error', { error: String(error) });
      await sleep(IDLE_MS);
    }
  }

  await prisma.$disconnect();
  logger.info('outbox worker stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false;
  });
}

void loop();
