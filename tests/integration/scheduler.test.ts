import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { claimDueJobs, runDueJobs, type JobHandler } from '@/worker/scheduler';
import { JOB_DEFINITIONS, jobs } from '@/worker/jobs';

/**
 * The scheduled-job runner. Nothing in the codebase could run recurring work
 * before this, which is what blocked steps 5.6 (screening on a schedule) and
 * 5.9 (expiry sweeps) — and what Stage 7 will need too.
 *
 * Asserted the same way as the outbox, because it borrows the same mechanics:
 * SKIP LOCKED claiming, the run counted before the handler, and a pass that
 * reports what happened.
 */

async function defineJob(input: {
  key: string;
  intervalSeconds?: number;
  enabled?: boolean;
  dueAt?: Date;
}) {
  return prisma.scheduledJob.create({
    data: {
      key: input.key,
      description: `Test job ${input.key}`,
      intervalSeconds: input.intervalSeconds ?? 3600,
      enabled: input.enabled ?? true,
      nextRunAt: input.dueAt ?? new Date(Date.now() - 1000),
    },
  });
}

/** What the passage of the interval would have done. */
async function makeDue(key: string) {
  await prisma.scheduledJob.update({
    where: { key },
    data: { nextRunAt: new Date(Date.now() - 1000) },
  });
}

describe('claiming', () => {
  it('claims a due job and pushes its next run a full interval out', async () => {
    await defineJob({ key: 'test.due', intervalSeconds: 3600 });

    const before = Date.now();
    const claimed = await claimDueJobs();

    expect(claimed.map((job) => job.key)).toEqual(['test.due']);

    const row = await prisma.scheduledJob.findUniqueOrThrow({ where: { key: 'test.due' } });
    expect(row.runCount).toBe(1);
    expect(row.lastRunAt).not.toBeNull();
    // Roughly an hour out, from now rather than from the old due time.
    expect(row.nextRunAt.getTime()).toBeGreaterThan(before + 3_500_000);
  });

  it('does not claim a job that is not yet due', async () => {
    await defineJob({ key: 'test.future', dueAt: new Date(Date.now() + 60_000) });
    expect(await claimDueJobs()).toEqual([]);
  });

  it('never claims a disabled job', async () => {
    await defineJob({ key: 'test.disabled', enabled: false });

    // An operator's off switch has to actually switch it off, however overdue
    // the row looks.
    expect(await claimDueJobs()).toEqual([]);
  });

  it('skips missed windows instead of catching up', async () => {
    // A worker down for a day must not then run a daily sweep once per missed
    // hour; next_run_at is computed from now, not from the old value.
    await defineJob({
      key: 'test.overdue',
      intervalSeconds: 3600,
      dueAt: new Date(Date.now() - 24 * 3600 * 1000),
    });

    await claimDueJobs();
    expect(await claimDueJobs()).toEqual([]);
  });
});

describe('running', () => {
  it('records a success and clears the failure count', async () => {
    await defineJob({ key: 'test.ok' });
    await prisma.scheduledJob.update({ where: { key: 'test.ok' }, data: { failureCount: 3 } });

    let ran = 0;
    const result = await runDueJobs({ handlers: { 'test.ok': async () => { ran += 1; } } });

    expect(result).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });
    expect(ran).toBe(1);

    const row = await prisma.scheduledJob.findUniqueOrThrow({ where: { key: 'test.ok' } });
    expect(row.lastStatus).toBe('SUCCEEDED');
    expect(row.lastError).toBeNull();
    expect(row.failureCount).toBe(0);
    expect(row.lastDurationMs).not.toBeNull();
  });

  it('records a failure, counts it, and runs again at the next interval', async () => {
    await defineJob({ key: 'test.flaky' });

    let calls = 0;
    const handler: JobHandler = async () => {
      calls += 1;
      if (calls === 1) throw new Error('database was busy');
    };

    expect(await runDueJobs({ handlers: { 'test.flaky': handler } })).toMatchObject({ failed: 1 });

    let row = await prisma.scheduledJob.findUniqueOrThrow({ where: { key: 'test.flaky' } });
    expect(row.lastStatus).toBe('FAILED');
    expect(row.lastError).toContain('database was busy');
    expect(row.failureCount).toBe(1);

    // Not retried immediately — a sweep failing because the database is
    // struggling must not then hammer it.
    expect(await runDueJobs({ handlers: { 'test.flaky': handler } })).toMatchObject({ claimed: 0 });

    await makeDue('test.flaky');
    expect(await runDueJobs({ handlers: { 'test.flaky': handler } })).toMatchObject({ succeeded: 1 });

    row = await prisma.scheduledJob.findUniqueOrThrow({ where: { key: 'test.flaky' } });
    expect(row.failureCount).toBe(0);
    expect(calls).toBe(2);
  });

  it('lets one failing sweep not stop the others in the same pass', async () => {
    await defineJob({ key: 'test.breaks' });
    await defineJob({ key: 'test.works' });

    let worked = false;
    const result = await runDueJobs({
      handlers: {
        'test.breaks': async () => {
          throw new Error('boom');
        },
        'test.works': async () => {
          worked = true;
        },
      },
    });

    expect(result).toMatchObject({ claimed: 2, succeeded: 1, failed: 1 });
    expect(worked).toBe(true);
  });

  it('records a job whose handler has been removed, loudly', async () => {
    await defineJob({ key: 'test.orphan' });

    const result = await runDueJobs({ handlers: {} });

    // A row with no handler is a deploy that dropped the code but not the
    // row, and the sweep it names is silently not happening.
    expect(result).toMatchObject({ claimed: 1, unregistered: 1 });
    const row = await prisma.scheduledJob.findUniqueOrThrow({ where: { key: 'test.orphan' } });
    expect(row.lastStatus).toBe('FAILED');
    expect(row.lastError).toContain('No handler');
  });

  it('runs each job once when two workers pass at the same time', async () => {
    for (const key of ['test.a', 'test.b', 'test.c', 'test.d']) await defineJob({ key });

    const ran: string[] = [];
    const handler = (key: string): JobHandler => async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      ran.push(key);
    };
    const handlers = Object.fromEntries(
      ['test.a', 'test.b', 'test.c', 'test.d'].map((key) => [key, handler(key)]),
    );

    const [first, second] = await Promise.all([
      runDueJobs({ handlers }),
      runDueJobs({ handlers }),
    ]);

    // SKIP LOCKED again: neither worker waits, and neither picks up a job the
    // other has claimed.
    expect(first.claimed + second.claimed).toBe(4);
    expect(ran.sort()).toEqual(['test.a', 'test.b', 'test.c', 'test.d']);

    const rows = await prisma.scheduledJob.findMany();
    expect(rows.every((row) => row.runCount === 1)).toBe(true);
  });
});

describe('the job registry', () => {
  it('has a handler for every definition and a definition for every handler', () => {
    const defined = JOB_DEFINITIONS.map((job) => job.key).sort();
    const handled = Object.keys(jobs).sort();

    // A definition with no handler is a sweep that silently never happens; a
    // handler with no definition is code that never runs.
    expect(defined).toEqual(handled);
  });

  it('gives every job a description and a sane interval', () => {
    for (const job of JOB_DEFINITIONS) {
      expect(job.description.length, `${job.key} needs a description`).toBeGreaterThan(10);
      expect(job.intervalSeconds, `${job.key} interval`).toBeGreaterThanOrEqual(60);
    }
  });
});
