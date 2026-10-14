import { prisma, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import { assessSystem, type Problem, type SystemSnapshot } from '../domain/system-health';

/**
 * Whether the background work is getting done (PLT-04).
 *
 * The outbox and the scheduled jobs are how everything that happens after a
 * request returns is delivered, and the worker that runs them fails quietly.
 * This reads their state, says what is wrong, and puts a given-up event back.
 */

export const SystemErrors = {
  eventNotFound: () => new HttpError('event_not_found', 'That event does not exist.', 404),
  notReplayable: (status: string) =>
    new HttpError(
      'event_not_replayable',
      `A ${status} event is not one that gave up, so there is nothing to replay.`,
      409,
    ),
};

/** Enough of an error to diagnose it; a handler's message can run to a stack trace. */
const ERROR_MAX_LENGTH = 300;

export interface JobStatusView {
  key: string;
  description: string;
  enabled: boolean;
  intervalSeconds: number;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastStatus: 'SUCCEEDED' | 'FAILED' | null;
  lastError: string | null;
  failureCount: number;
}

/**
 * How texts have fared in the last day (M16-05). Information, not a problem: a failover is the
 * system working, and what to page on is a threshold somebody should choose.
 */
export interface MessageDeliveryView {
  /** Whether any gateway has been told where to send reports; without it "unconfirmed" means nothing. */
  receiptsEnabled: boolean;
  /** Messages a second gateway had to take because the first did not. */
  failedOver24h: number;
  /** Messages a gateway took and then reported it could not deliver. */
  failedAfterAccepted24h: number;
  /** Taken more than thirty minutes ago and still no final report; null when reports are not enabled. */
  unconfirmed: number | null;
}

export interface SystemStatusView {
  status: 'ok' | 'degraded';
  problems: Problem[];
  outbox: SystemSnapshot['outbox'];
  jobs: JobStatusView[];
  messages: MessageDeliveryView;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a gateway is given to report before a message with no report is counted as unconfirmed. */
const REPORT_GRACE_MS = 30 * 60 * 1000;

async function messageDelivery(now: Date): Promise<MessageDeliveryView> {
  const since = new Date(now.getTime() - DAY_MS);
  const receiptsEnabled = Boolean(env.SMS_RECEIPT_SECRET);
  const [failedOver24h, failedAfterAccepted24h, unconfirmed] = await Promise.all([
    prisma.notificationMessage.count({
      where: { channel: 'sms', failedOverFrom: { not: null }, createdAt: { gte: since } },
    }),
    prisma.notificationMessage.count({
      where: { channel: 'sms', deliveryStatus: 'FAILED', createdAt: { gte: since } },
    }),
    receiptsEnabled
      ? prisma.notificationMessage.count({
          where: {
            channel: 'sms',
            provider: { not: null },
            createdAt: { gte: since },
            sentAt: { not: null, lte: new Date(now.getTime() - REPORT_GRACE_MS) },
            OR: [{ deliveryStatus: null }, { deliveryStatus: 'PENDING' }],
          },
        })
      : Promise.resolve(null),
  ]);
  return { receiptsEnabled, failedOver24h, failedAfterAccepted24h, unconfirmed };
}

/**
 * The state of the outbox and the jobs, and what is wrong with it.
 *
 * "Due" means ready to be delivered now and not yet delivered: a pending or
 * failed event whose time has come, or one whose claim's lease ran out. The
 * oldest such event is how far behind the worker is - and when there is no
 * worker, how long it has been gone.
 */
export async function systemStatus(now: Date = new Date()): Promise<SystemStatusView> {
  const [grouped, oldestDue, jobs, messages] = await Promise.all([
    prisma.outboxEvent.groupBy({
      by: ['status'],
      where: { status: { in: ['PENDING', 'FAILED', 'DEAD_LETTER'] } },
      _count: { _all: true },
    }),
    prisma.outboxEvent.findFirst({
      where: { status: { in: ['PENDING', 'FAILED', 'PROCESSING'] }, availableAt: { lte: now } },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    }),
    prisma.scheduledJob.findMany({ orderBy: { key: 'asc' } }),
    messageDelivery(now),
  ]);

  const count = (status: string) => grouped.find((row) => row.status === status)?._count._all ?? 0;
  const outbox = {
    pending: count('PENDING'),
    failed: count('FAILED'),
    deadLetter: count('DEAD_LETTER'),
    oldestDueAt: oldestDue?.availableAt ?? null,
  };

  const jobViews: JobStatusView[] = jobs.map((job) => ({
    key: job.key,
    description: job.description,
    enabled: job.enabled,
    intervalSeconds: job.intervalSeconds,
    nextRunAt: job.nextRunAt,
    lastRunAt: job.lastRunAt,
    lastStatus: job.lastStatus,
    lastError: job.lastError ? job.lastError.slice(0, ERROR_MAX_LENGTH) : null,
    failureCount: job.failureCount,
  }));

  const problems = assessSystem({ outbox, jobs: jobViews }, now);
  return { status: problems.length === 0 ? 'ok' : 'degraded', problems, outbox, jobs: jobViews, messages };
}

export interface TroubledEventView {
  id: string;
  eventType: string;
  aggregateType: string;
  status: string;
  attempts: number;
  lastError: string | null;
  availableAt: Date;
  createdAt: Date;
}

/**
 * Events that failed or gave up, oldest first. Never the payload: what an event
 * carries is somebody's data, and the person looking is diagnosing a delivery.
 */
export async function listTroubledEvents(limit = 50): Promise<TroubledEventView[]> {
  const rows = await prisma.outboxEvent.findMany({
    where: { status: { in: ['DEAD_LETTER', 'FAILED'] } },
    orderBy: [{ status: 'desc' }, { createdAt: 'asc' }],
    take: limit,
    select: {
      id: true,
      eventType: true,
      aggregateType: true,
      status: true,
      attempts: true,
      lastError: true,
      availableAt: true,
      createdAt: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    lastError: row.lastError ? row.lastError.slice(0, ERROR_MAX_LENGTH) : null,
  }));
}

/**
 * Puts an event that gave up (or is waiting out a retry) back to be delivered
 * now, with its attempts counted from the start.
 *
 * Replaying runs the handlers again, so they have to be repeatable; the
 * notification handlers are (they skip anybody already told) and the financial
 * events carry an idempotency key. Conditional on the event still being
 * failed or dead, so two people replaying together queue it once.
 */
export async function replayEvent(input: {
  eventId: string;
  actorId: string;
}): Promise<TroubledEventView> {
  return prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.outboxEvent.findUnique({ where: { id: input.eventId } });
    if (!existing) throw SystemErrors.eventNotFound();
    if (existing.status !== 'DEAD_LETTER' && existing.status !== 'FAILED') {
      throw SystemErrors.notReplayable(existing.status);
    }

    const claimed = await tx.outboxEvent.updateMany({
      where: { id: existing.id, status: { in: ['DEAD_LETTER', 'FAILED'] } },
      data: { status: 'PENDING', attempts: 0, availableAt: new Date(), processedAt: null },
    });
    if (claimed.count !== 1) throw SystemErrors.notReplayable('changed');

    await recordAudit(tx, {
      action: 'outbox.replayed',
      entityType: 'audit.outbox_events',
      entityId: existing.id,
      actorId: input.actorId,
      scopeType: 'PLATFORM',
      before: {
        status: existing.status,
        attempts: existing.attempts,
        lastError: existing.lastError?.slice(0, ERROR_MAX_LENGTH) ?? null,
      },
      after: { status: 'PENDING' },
    });

    const row = await tx.outboxEvent.findUniqueOrThrow({
      where: { id: existing.id },
      select: {
        id: true,
        eventType: true,
        aggregateType: true,
        status: true,
        attempts: true,
        lastError: true,
        availableAt: true,
        createdAt: true,
      },
    });
    return row;
  });
}
