import { describe, expect, it } from 'vitest';
import {
  WORKER_LAG_SECONDS,
  assessSystem,
  type SystemSnapshot,
} from './system-health';

const NOW = new Date('2026-10-13T12:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);
const ahead = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

const healthy: SystemSnapshot = {
  outbox: { pending: 3, failed: 0, deadLetter: 0, oldestDueAt: null },
  jobs: [
    {
      key: 'expire-credentials',
      enabled: true,
      intervalSeconds: 3600,
      nextRunAt: ahead(1800),
      lastStatus: 'SUCCEEDED',
      lastError: null,
    },
  ],
};

const keys = (snapshot: SystemSnapshot) => assessSystem(snapshot, NOW).map((problem) => problem.key);

describe('what is wrong with background work', () => {
  it('finds nothing in a healthy system', () => {
    expect(assessSystem(healthy, NOW)).toEqual([]);
  });

  it('is not alarmed by events waiting their turn', () => {
    expect(
      keys({ ...healthy, outbox: { ...healthy.outbox, pending: 400, oldestDueAt: ago(20) } }),
    ).toEqual([]);
  });

  it('is not alarmed by an event that is being retried', () => {
    // Retrying is the system working; it becomes a problem when it gives up.
    expect(keys({ ...healthy, outbox: { ...healthy.outbox, failed: 5 } })).toEqual([]);
  });

  describe('a worker that is not keeping up, or not running', () => {
    it('is reported once the oldest due event has waited too long', () => {
      const snapshot = {
        ...healthy,
        outbox: { ...healthy.outbox, oldestDueAt: ago(WORKER_LAG_SECONDS + 60) },
      };
      expect(keys(snapshot)).toEqual(['worker_lagging']);
      expect(assessSystem(snapshot, NOW)[0]!.severity).toBe('critical');
    });

    it('is not reported just inside the limit', () => {
      expect(
        keys({ ...healthy, outbox: { ...healthy.outbox, oldestDueAt: ago(WORKER_LAG_SECONDS - 5) } }),
      ).toEqual([]);
    });

    it('is reported when a job has not run when it was due', () => {
      const snapshot = {
        ...healthy,
        jobs: [{ ...healthy.jobs[0]!, nextRunAt: ago(WORKER_LAG_SECONDS + 60) }],
      };
      expect(keys(snapshot)).toEqual(['job_overdue']);
      expect(assessSystem(snapshot, NOW)[0]!.message).toContain('expire-credentials');
    });

    it('is one finding however many jobs are late, naming them all', () => {
      // Nine jobs are not each a problem; one worker is not running.
      const late = (key: string) => ({
        ...healthy.jobs[0]!,
        key,
        nextRunAt: ago(WORKER_LAG_SECONDS + 600),
      });
      const problems = assessSystem({ ...healthy, jobs: [late('a-sweep'), late('b-sweep'), late('c-sweep')] }, NOW);

      expect(problems.map((problem) => problem.key)).toEqual(['job_overdue']);
      expect(problems[0]!.message).toContain('3 scheduled jobs');
      for (const key of ['a-sweep', 'b-sweep', 'c-sweep']) expect(problems[0]!.message).toContain(key);
    });

    it('ignores a job that has been switched off', () => {
      expect(
        keys({
          ...healthy,
          jobs: [{ ...healthy.jobs[0]!, enabled: false, nextRunAt: ago(86_400) }],
        }),
      ).toEqual([]);
    });
  });

  it('reports events that gave up, because something that should have happened has not', () => {
    const snapshot = { ...healthy, outbox: { ...healthy.outbox, deadLetter: 2 } };
    expect(keys(snapshot)).toEqual(['dead_letters']);
    expect(assessSystem(snapshot, NOW)[0]!.message).toContain('2');
  });

  it('reports a job whose last run failed, with what it said', () => {
    const snapshot = {
      ...healthy,
      jobs: [{ ...healthy.jobs[0]!, lastStatus: 'FAILED' as const, lastError: 'connection reset' }],
    };
    const [problem] = assessSystem(snapshot, NOW);
    expect(problem).toMatchObject({ key: 'job_failing', subject: 'expire-credentials' });
    expect(problem!.message).toContain('connection reset');
  });

  it('reports every problem there is, the most serious first', () => {
    const snapshot: SystemSnapshot = {
      outbox: { pending: 9, failed: 0, deadLetter: 1, oldestDueAt: ago(WORKER_LAG_SECONDS + 600) },
      jobs: [{ ...healthy.jobs[0]!, lastStatus: 'FAILED', lastError: 'x' }],
    };
    expect(keys(snapshot)).toEqual(['worker_lagging', 'dead_letters', 'job_failing']);
  });
});
