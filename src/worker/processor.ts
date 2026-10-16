import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { MAX_ATTEMPTS, nextAvailableAt } from '../lib/outbox';
import { withTrace } from '../lib/trace';

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
 * How long a claim holds an event before another worker may take it back.
 *
 * Handlers are short — a notification, a recomputed timesheet — so five minutes
 * is far longer than a healthy one takes and short enough that a worker killed
 * mid-event costs a few minutes of delay and not a lost event.
 */
export const CLAIM_LEASE_SECONDS = 300;

/**
 * Claims due events for this worker, marking them PROCESSING and counting the
 * attempt before any handler runs — a handler that hangs must not be retried
 * for free. SKIP LOCKED is what lets several workers run at once without two
 * of them delivering the same event.
 *
 * The claim carries a **lease**: `available_at` is pushed out by
 * CLAIM_LEASE_SECONDS, and a PROCESSING event whose lease has run out is
 * claimable again. Before this, a worker killed after claiming (a deploy, an
 * out-of-memory kill) left up to a batch of events in PROCESSING for ever,
 * because the claim only looked at PENDING and FAILED.
 *
 * An event whose lease ran out *after its final attempt* is dead-lettered
 * instead. A handler that kills the worker never reaches the code that
 * dead-letters it, so reclaiming it without limit would take a worker down
 * every lease.
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
  const abandoned = await client.$queryRaw<{ id: string }[]>`
    UPDATE audit.outbox_events
       SET status = 'DEAD_LETTER',
           last_error = 'The worker that claimed this event stopped before finishing it, on its last attempt.'
     WHERE status = 'PROCESSING'
       AND available_at <= now()
       AND attempts >= ${MAX_ATTEMPTS}
     RETURNING id
  `;
  if (abandoned.length > 0) {
    logger.error('outbox events abandoned on their last attempt', { count: abandoned.length });
  }

  return client.$queryRaw<ClaimedEvent[]>`
    UPDATE audit.outbox_events
       SET status = 'PROCESSING',
           attempts = attempts + 1,
           available_at = now() + make_interval(secs => ${CLAIM_LEASE_SECONDS})
     WHERE id IN (
       SELECT id FROM audit.outbox_events
        WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
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
    // Under the trace of the action that published the event, so what the handler writes or publishes
    // in turn carries the same id (AUD-13). An event published outside any request has none, and gets
    // one here, so the handler's own rows are still tied to each other and to this delivery.
    await withTrace({ correlationId: event.correlation_id ?? randomUUID() }, () =>
      handler(event.payload as Record<string, unknown>),
    );
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
