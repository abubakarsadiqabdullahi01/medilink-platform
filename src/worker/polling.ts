/**
 * How often the worker looks for work.
 *
 * It used to look every two seconds, always, at both the outbox and the
 * scheduled-job table — about 86,000 passes a day, nearly all of them finding
 * nothing. Two separate observations make most of that unnecessary:
 *
 * - **Scheduled jobs are hourly and daily.** Checking whether one is due every
 *   two seconds buys nothing over every thirty; a job that is a few seconds late
 *   is no later than it was.
 *
 * - **The outbox is latency-sensitive, but only just after something happened.**
 *   A practitioner who has just signed up is waiting for the event that grants
 *   their role, and the sign-up screen waits about eight seconds for it. So the
 *   worker stays at two seconds for as long as work is arriving and for a minute
 *   after, and only then relaxes — to five seconds, not more. A longer ceiling
 *   would save fewer queries than it costs: sign-ups are sparse, so nearly every
 *   one would arrive during the slowest setting and wait for it.
 *
 * Pure so it can be tested; index.ts only applies it. When a Postgres driver
 * that supports LISTEN/NOTIFY is available, the better answer is to wake the
 * worker on insert and poll rarely as a backstop.
 */

/** Looking this often while work is arriving, and for a while after. */
export const ACTIVE_POLL_MS = 2_000;

/** After a minute of finding nothing. */
export const RELAXED_POLL_MS = 5_000;

/** Passes with nothing to do before relaxing: thirty at two seconds is a minute. */
export const IDLE_PASSES_BEFORE_RELAXING = 30;

/** How long to sleep after a pass that found no work, given how many in a row did. */
export function nextOutboxDelay(consecutiveIdlePasses: number): number {
  return consecutiveIdlePasses >= IDLE_PASSES_BEFORE_RELAXING ? RELAXED_POLL_MS : ACTIVE_POLL_MS;
}

/** Scheduled jobs recur hourly at the shortest, so checking more often than this is waste. */
export const JOB_CHECK_MS = 30_000;

/** Whether it is time to look at the scheduled-job table again. */
export function jobsCheckDue(lastCheckedAt: number | null, now: number): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= JOB_CHECK_MS;
}
