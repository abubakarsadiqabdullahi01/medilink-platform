import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { MAX_ATTEMPTS, nextAvailableAt } from '../lib/outbox';

/**
 * One pass of the outbox worker, separated from the loop in ./index.ts so the
 * retry, backoff and dead-letter behaviour can be driven directly by a test.
 *
 * Stage 4.6 asks for evidence that "an event survives a failing consumer".
 * That is not observable while claiming, dispatch and the sleep between
 * passes are welded into a single `while (true)`, so the pass is a function
 * and the loop only decides when to call it.
 */

export type EventHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface ClaimedEvent {
  id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
  correlation_id: string | null;
}

export const DEFAULT_BATCH_SIZE = 20;

/**
 * Claims due events for this worker, marking them PROCESSING and counting the
 * attempt before any handler runs — a handler that hangs must not be retried
 * for free. SKIP LOCKED is what lets several workers run at once without two
 * of them delivering the same event.
 *
 * Due-ness is decided by the database clock rather than an injected one: the
 * comparison stays inside the same statement that takes the lock. A test that
 * needs a backed-off event to become due rewinds its available_at, which is
 * what the passage of time would have done anyway.
 */
export async function claimDueEvents(
  client: Pick<PrismaClient, '$queryRaw'> = prisma,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<ClaimedEvent[]> {
  return client.$queryRaw<ClaimedEvent[]>`
    UPDATE audit.outbox_events
       SET status = 'PROCESSING', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM audit.outbox_events
        WHERE status IN ('PENDING', 'FAILED')
          AND available_at <= now()
        ORDER BY available_at
         FOR UPDATE SKIP LOCKED
        LIMIT ${Prisma.raw(String(Math.trunc(batchSize)))}
     )
     RETURNING id, event_type, payload, attempts, correlation_id
  `;
}

export type EventOutcome = 'processed' | 'skipped' | 'failed' | 'dead_lettered';

/**
 * Runs one claimed event through its handler and records the outcome.
 *
 * A throwing handler moves the event to FAILED with the next attempt pushed
 * into the future by exponential backoff, so it is retried rather than lost.
 * Only after MAX_ATTEMPTS does it become DEAD_LETTER, which is a queue an
 * operator works — not a silent discard.
 */
export async function processEvent(
  event: ClaimedEvent,
  handlers: Record<string, EventHandler>,
  client: Pick<PrismaClient, 'outboxEvent'> = prisma,
  now: Date = new Date(),
): Promise<EventOutcome> {
  const log = logger.child({ correlationId: event.correlation_id ?? undefined, eventId: event.id });
  const handler = handlers[event.event_type];

  // An event nobody consumes yet is not a failure: modules are added stage by
  // stage, and retrying it forever would bury the events that do matter.
  if (!handler) {
    log.warn('no handler registered; marking processed', { eventType: event.event_type });
    await client.outboxEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: now },
    });
    return 'skipped';
  }

  try {
    await handler(event.payload as Record<string, unknown>);
    await client.outboxEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: now, lastError: null },
    });
    log.info('event processed', { eventType: event.event_type });
    return 'processed';
  } catch (error) {
    const dead = event.attempts >= MAX_ATTEMPTS;
    await client.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: dead ? 'DEAD_LETTER' : 'FAILED',
        availableAt: nextAvailableAt(event.attempts, now),
        lastError: error instanceof Error ? error.message.slice(0, 1000) : 'unknown error',
      },
    });
    log[dead ? 'error' : 'warn']('event failed', {
      eventType: event.event_type,
      attempts: event.attempts,
      dead,
    });
    return dead ? 'dead_lettered' : 'failed';
  }
}

export interface PassResult {
  claimed: number;
  processed: number;
  skipped: number;
  failed: number;
  deadLettered: number;
}

/** One claim-and-dispatch pass. Returns what happened, so a caller can assert on it. */
export async function runOnce(options: {
  handlers: Record<string, EventHandler>;
  client?: PrismaClient;
  batchSize?: number;
  now?: Date;
}): Promise<PassResult> {
  const client = options.client ?? prisma;
  const batch = await claimDueEvents(client, options.batchSize ?? DEFAULT_BATCH_SIZE);

  const result: PassResult = {
    claimed: batch.length,
    processed: 0,
    skipped: 0,
    failed: 0,
    deadLettered: 0,
  };

  for (const event of batch) {
    const outcome = await processEvent(event, options.handlers, client, options.now);
    if (outcome === 'processed') result.processed += 1;
    else if (outcome === 'skipped') result.skipped += 1;
    else if (outcome === 'failed') result.failed += 1;
    else result.deadLettered += 1;
  }

  return result;
}
