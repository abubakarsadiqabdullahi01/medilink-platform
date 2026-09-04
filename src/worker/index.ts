import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { MAX_ATTEMPTS, nextAvailableAt } from '../lib/outbox';
import { handlers } from './handlers';

/**
 * Outbox worker. Claims due events with SKIP LOCKED so several workers can
 * run without processing the same event twice, then hands each to its
 * handler. A throwing handler is retried with backoff; after MAX_ATTEMPTS the
 * event moves to DEAD_LETTER and raises an alert rather than disappearing.
 */
const BATCH_SIZE = 20;
const IDLE_MS = 2000;

let running = true;

async function claimBatch() {
  return prisma.$queryRaw<
    { id: string; event_type: string; payload: unknown; attempts: number; correlation_id: string | null }[]
  >`
    UPDATE audit.outbox_events
       SET status = 'PROCESSING', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM audit.outbox_events
        WHERE status IN ('PENDING', 'FAILED')
          AND available_at <= now()
        ORDER BY available_at
         FOR UPDATE SKIP LOCKED
        LIMIT ${BATCH_SIZE}
     )
     RETURNING id, event_type, payload, attempts, correlation_id
  `;
}

async function processEvent(event: {
  id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  correlation_id: string | null;
}) {
  const log = logger.child({ correlationId: event.correlation_id ?? undefined, eventId: event.id });
  const handler = handlers[event.event_type];

  if (!handler) {
    log.warn('no handler registered; marking processed', { eventType: event.event_type });
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
    return;
  }

  try {
    await handler(event.payload as Record<string, unknown>);
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
    });
    log.info('event processed', { eventType: event.event_type });
  } catch (error) {
    const dead = event.attempts >= MAX_ATTEMPTS;
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: dead ? 'DEAD_LETTER' : 'FAILED',
        availableAt: nextAvailableAt(event.attempts),
        lastError: error instanceof Error ? error.message.slice(0, 1000) : 'unknown error',
      },
    });
    log[dead ? 'error' : 'warn']('event failed', {
      eventType: event.event_type,
      attempts: event.attempts,
      dead,
    });
  }
}

async function loop() {
  logger.info('outbox worker started');
  while (running) {
    try {
      const batch = await claimBatch();
      if (batch.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
        continue;
      }
      for (const event of batch) await processEvent(event);
    } catch (error) {
      logger.error('worker loop error', { error: String(error) });
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
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
