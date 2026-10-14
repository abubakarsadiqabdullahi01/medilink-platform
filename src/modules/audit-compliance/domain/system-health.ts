/**
 * What is wrong with the background work. Pure, no database.
 *
 * Everything that happens after a request returns - texts, reminders, expiry
 * sweeps, the sweep that notices an absence - is done by the worker, which fails
 * quietly: an event the worker gave up on, or a worker that is not running at
 * all, looks from the outside like nothing happening (PLT-04). These are the
 * conditions that mean something that should have happened has not.
 */

/** How long a due event may wait, and how late a job may be, before the worker is called lagging. */
export const WORKER_LAG_SECONDS = 300;

export interface SystemSnapshot {
  outbox: {
    pending: number;
    /** Being retried; not a problem until it gives up and becomes a dead letter. */
    failed: number;
    deadLetter: number;
    /** When the oldest event that was due to be delivered became due; null if none is waiting. */
    oldestDueAt: Date | null;
  };
  jobs: {
    key: string;
    enabled: boolean;
    intervalSeconds: number;
    nextRunAt: Date;
    lastStatus: 'SUCCEEDED' | 'FAILED' | null;
    lastError: string | null;
  }[];
}

export type ProblemKey = 'worker_lagging' | 'dead_letters' | 'job_overdue' | 'job_failing';

export interface Problem {
  key: ProblemKey;
  severity: 'critical' | 'warning';
  message: string;
  /** The job concerned, where there is one. */
  subject?: string;
}

const SEVERITY_ORDER: ProblemKey[] = ['worker_lagging', 'job_overdue', 'dead_letters', 'job_failing'];

export function assessSystem(snapshot: SystemSnapshot, now: Date): Problem[] {
  const problems: Problem[] = [];
  const waitedSeconds = (since: Date) => (now.getTime() - since.getTime()) / 1000;

  const { oldestDueAt } = snapshot.outbox;
  if (oldestDueAt && waitedSeconds(oldestDueAt) > WORKER_LAG_SECONDS) {
    problems.push({
      key: 'worker_lagging',
      severity: 'critical',
      message: `An event has been waiting ${Math.round(waitedSeconds(oldestDueAt) / 60)} minutes to be delivered. The worker is behind or not running, and texts and reminders are not going out.`,
    });
  }

  // One finding, not one per job: when the worker is down every job is late, and
  // nine alarms for one cause is how people learn to ignore the page.
  const late = snapshot.jobs.filter(
    (job) => job.enabled && waitedSeconds(job.nextRunAt) > WORKER_LAG_SECONDS,
  );
  if (late.length > 0) {
    const oldest = Math.max(...late.map((job) => waitedSeconds(job.nextRunAt)));
    problems.push({
      key: 'job_overdue',
      severity: 'critical',
      message:
        late.length === 1
          ? `${late[0]!.key} was due ${Math.round(oldest / 60)} minutes ago and has not run. The worker is not running.`
          : `${late.length} scheduled jobs have not run when they were due (${late.map((job) => job.key).join(', ')}), the longest ${Math.round(oldest / 60)} minutes late. The worker is not running.`,
    });
  }

  if (snapshot.outbox.deadLetter > 0) {
    problems.push({
      key: 'dead_letters',
      severity: 'critical',
      message: `${snapshot.outbox.deadLetter} event${snapshot.outbox.deadLetter === 1 ? ' has' : 's have'} given up after every retry. Something that should have happened - a text, a reminder, a recomputation - has not. Read why, fix it, and replay them.`,
    });
  }

  for (const job of snapshot.jobs) {
    if (job.enabled && job.lastStatus === 'FAILED') {
      problems.push({
        key: 'job_failing',
        severity: 'warning',
        subject: job.key,
        message: `${job.key} failed on its last run${job.lastError ? `: ${job.lastError}` : '.'}`,
      });
    }
  }

  // Worst first, and stable within a kind.
  return problems.sort(
    (left, right) => SEVERITY_ORDER.indexOf(left.key) - SEVERITY_ORDER.indexOf(right.key),
  );
}
