import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

/**
 * The scheduled-job runner: recurring sweeps, claimed and run by the same
 * worker process as the outbox.
 *
 * It borrows the outbox's mechanics deliberately — `FOR UPDATE SKIP LOCKED`,
 * the attempt counted before the handler runs, a pass that returns counts a
 * test can assert on. Two workers can run without either waiting for the
 * other or running a sweep twice.
 */

export type JobHandler = () => Promise<void>;

export interface ClaimedJob {
  id: string;
  key: string;
  interval_seconds: number;
  run_count: number;
}

export const DEFAULT_JOB_BATCH_SIZE = 10;

/**
 * Claims every job now due, moving `next_run_at` forward before any handler
 * runs — so a handler that hangs cannot be claimed again by the next pass.
 *
 * The next run is `now() + interval`, not `next_run_at + interval`. After an
 * outage the latter would still be in the past and the sweep would run
 * repeatedly to "catch up", which for an expiry sweep means the same work
 * several times over. Skipping the missed windows is the correct behaviour
 * for everything scheduled here.
 */
export async function claimDueJobs(
  client: Pick<PrismaClient, '$queryRaw'> = prisma,
  batchSize: number = DEFAULT_JOB_BATCH_SIZE,
): Promise<ClaimedJob[]> {
  return client.$queryRaw<ClaimedJob[]>`
    UPDATE audit.scheduled_jobs
       SET next_run_at = now() + make_interval(secs => interval_seconds),
           run_count = run_count + 1,
           last_run_at = now()
     WHERE id IN (
       SELECT id FROM audit.scheduled_jobs
        WHERE enabled
          AND next_run_at <= now()
        ORDER BY next_run_at
         FOR UPDATE SKIP LOCKED
        LIMIT ${Prisma.raw(String(Math.trunc(batchSize)))}
     )
     RETURNING id, key, interval_seconds, run_count
  `;
}

export type JobOutcome = 'succeeded' | 'failed' | 'unregistered';

/**
 * Runs one claimed job and records the outcome.
 *
 * A failure is recorded and left to the next interval rather than retried
 * immediately: these are sweeps, and one that fails because the database is
 * struggling should not then hammer it. `failureCount` is what an alert
 * watches — a sweep failing repeatedly is the signal, not a single blip.
 */
export async function runJob(
  job: ClaimedJob,
  handlers: Record<string, JobHandler>,
  client: Pick<PrismaClient, 'scheduledJob'> = prisma,
): Promise<JobOutcome> {
  const log = logger.child({ jobKey: job.key, jobId: job.id });
  const handler = handlers[job.key];

  if (!handler) {
    // A row with no handler is a deploy that removed the code but not the
    // row. Loud, because the sweep it names is silently not happening.
    log.error('scheduled job has no registered handler', { key: job.key });
    await client.scheduledJob.update({
      where: { id: job.id },
      data: { lastStatus: 'FAILED', lastError: 'No handler registered for this job key.' },
    });
    return 'unregistered';
  }

  const startedAt = Date.now();

  try {
    await handler();
    await client.scheduledJob.update({
      where: { id: job.id },
      data: {
        lastStatus: 'SUCCEEDED',
        lastError: null,
        failureCount: 0,
        lastDurationMs: Date.now() - startedAt,
      },
    });
    log.info('scheduled job succeeded', { durationMs: Date.now() - startedAt });
    return 'succeeded';
  } catch (error) {
    await client.scheduledJob.update({
      where: { id: job.id },
      data: {
        lastStatus: 'FAILED',
        lastError: error instanceof Error ? error.message.slice(0, 1000) : 'unknown error',
        failureCount: { increment: 1 },
        lastDurationMs: Date.now() - startedAt,
      },
    });
    log.error('scheduled job failed', { error: String(error) });
    return 'failed';
  }
}

export interface JobPassResult {
  claimed: number;
  succeeded: number;
  failed: number;
  unregistered: number;
}

/** One claim-and-run pass over everything due. */
export async function runDueJobs(options: {
  handlers: Record<string, JobHandler>;
  client?: PrismaClient;
  batchSize?: number;
}): Promise<JobPassResult> {
  const client = options.client ?? prisma;
  const due = await claimDueJobs(client, options.batchSize ?? DEFAULT_JOB_BATCH_SIZE);

  const result: JobPassResult = { claimed: due.length, succeeded: 0, failed: 0, unregistered: 0 };

  for (const job of due) {
    // One failing sweep must not stop the others in the same pass.
    const outcome = await runJob(job, options.handlers, client);
    if (outcome === 'succeeded') result.succeeded += 1;
    else if (outcome === 'failed') result.failed += 1;
    else result.unregistered += 1;
  }

  return result;
}
