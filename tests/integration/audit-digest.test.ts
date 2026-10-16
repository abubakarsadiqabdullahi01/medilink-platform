import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { jobs, JOB_DEFINITIONS } from '@/worker/jobs';
import { runJob } from '@/worker/scheduler';
import {
  AuditDigestMismatch,
  runAuditDigestSweep,
  verifyAuditDigests,
} from '@/modules/audit-compliance/application/audit-digest';
import { DIGESTED_COLUMNS, chainDigest, EMPTY_DAY_HASH } from '@/modules/audit-compliance/domain/audit-digest';

/**
 * AUD-06, the second half. The trigger refuses a change; this is what notices one made by somebody
 * who can switch the trigger off. Each test that tampers does exactly that, with the owner's
 * ability to `ALTER TABLE ... DISABLE TRIGGER`, because that is the attack the digest is for.
 *
 * Rows are written with `created_at` set, since a day has to be over to be sealed.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** The night of the 16th, by which the 15th is over and old enough to seal. */
const NIGHT = new Date('2026-10-16T12:00:00Z');

async function rowAt(iso: string, over: { reason?: string; action?: string } = {}) {
  return prisma.auditLog.create({
    data: {
      action: over.action ?? 'user.suspended',
      entityType: 'identity.users',
      entityId: '00000000-0000-4000-8000-0000000000bb',
      reason: over.reason ?? 'As written.',
      after: { status: 'SUSPENDED' },
      createdAt: new Date(iso),
    },
  });
}

/** What somebody who owns the table can do: switch the trigger off, change history, switch it on. */
async function asTheOwner<T>(change: () => Promise<T>): Promise<T> {
  await prisma.$executeRawUnsafe('ALTER TABLE audit.audit_log DISABLE TRIGGER audit_log_append_only');
  try {
    return await change();
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE audit.audit_log ENABLE TRIGGER audit_log_append_only');
  }
}

const sealedDays = async () =>
  (await prisma.auditDigest.findMany({ orderBy: { day: 'asc' } })).map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    rowCount: row.rowCount,
  }));

async function world() {
  const first = await rowAt('2026-10-12T09:00:00Z');
  await rowAt('2026-10-12T17:30:00Z', { reason: 'Second, the same day.' });
  await rowAt('2026-10-14T08:00:00Z');
  // Today, as the sweep sees it: not over, so not sealed.
  await rowAt('2026-10-16T10:00:00Z');
  return { first };
}

describe('sealing', () => {
  it('seals each finished day from the first row, an empty one included, and leaves today alone', async () => {
    await world();

    const result = await runAuditDigestSweep(NIGHT);

    expect(await sealedDays()).toEqual([
      { day: '2026-10-12', rowCount: 2 },
      { day: '2026-10-13', rowCount: 0 },
      { day: '2026-10-14', rowCount: 1 },
      { day: '2026-10-15', rowCount: 0 },
    ]);
    expect(result).toMatchObject({ sealed: 4, verified: 0 });
  });

  it('chains each day to the one before, from nothing', async () => {
    await world();
    await runAuditDigestSweep(NIGHT);

    const rows = await prisma.auditDigest.findMany({ orderBy: { day: 'asc' } });
    let previous = '';
    for (const row of rows) {
      expect(row.digest, row.day.toISOString()).toBe(chainDigest(previous, row.day.toISOString().slice(0, 10), row.rowCount, row.dayHash));
      previous = row.digest;
    }
    expect(rows[1]!.dayHash).toBe(EMPTY_DAY_HASH);
  });

  it('seals nothing twice: a second run the same night finds nothing new and changes nothing', async () => {
    await world();
    await runAuditDigestSweep(NIGHT);
    const before = await prisma.auditDigest.findMany({ orderBy: { day: 'asc' } });

    const again = await runAuditDigestSweep(NIGHT);

    expect(again).toMatchObject({ sealed: 0, verified: 4 });
    expect(await prisma.auditDigest.findMany({ orderBy: { day: 'asc' } })).toEqual(before);
  });

  it('seals the next day the next night, chained to the last, and takes in what was written on it', async () => {
    await world();
    await runAuditDigestSweep(NIGHT);
    const fifteenth = await prisma.auditDigest.findUniqueOrThrow({ where: { day: new Date('2026-10-15') } });

    const next = await runAuditDigestSweep(new Date('2026-10-17T12:00:00Z'));

    expect(next).toMatchObject({ sealed: 1, verified: 4 });
    const sixteenth = await prisma.auditDigest.findUniqueOrThrow({ where: { day: new Date('2026-10-16') } });
    expect(sixteenth.rowCount).toBe(1);
    expect(sixteenth.digest).toBe(chainDigest(fifteenth.digest, '2026-10-16', 1, sixteenth.dayHash));
  });

  it('waits for the slowest transaction on a day to have finished before sealing it', async () => {
    await rowAt('2026-10-14T08:00:00Z');
    await rowAt('2026-10-15T08:00:00Z');

    // Half past one in the morning of the 16th: the 15th is over, but not by long enough.
    await runAuditDigestSweep(new Date('2026-10-16T01:30:00Z'));
    expect((await sealedDays()).map((row) => row.day)).toEqual(['2026-10-14']);

    await runAuditDigestSweep(new Date('2026-10-16T02:30:00Z'));
    expect((await sealedDays()).map((row) => row.day)).toEqual(['2026-10-14', '2026-10-15']);
  });

  it('puts a row on the day it has in UTC, to the millisecond either side of midnight', async () => {
    await rowAt('2026-10-12T23:59:59.999Z');
    await rowAt('2026-10-13T00:00:00.000Z');

    await runAuditDigestSweep(NIGHT);

    expect((await sealedDays()).slice(0, 2)).toEqual([
      { day: '2026-10-12', rowCount: 1 },
      { day: '2026-10-13', rowCount: 1 },
    ]);
  });

  it('writes nothing when there is nothing to seal', async () => {
    expect(await runAuditDigestSweep(NIGHT)).toMatchObject({ sealed: 0, verified: 0 });
    await rowAt('2026-10-16T10:00:00Z');
    expect(await runAuditDigestSweep(NIGHT)).toMatchObject({ sealed: 0 });
    expect(await prisma.auditDigest.count()).toBe(0);
  });

  it('says aloud that it sealed a day, with the figures, so a copy can be kept somewhere the database’s owner cannot reach', async () => {
    const info = vi.spyOn(logger, 'info');
    await world();

    await runAuditDigestSweep(NIGHT);

    const lines = info.mock.calls.filter((call) => (call[1] as { event?: string } | undefined)?.event === 'audit_digest_sealed');
    expect(lines).toHaveLength(4);
    expect(lines[0]![1]).toMatchObject({ day: '2026-10-12', rowCount: 2 });
    expect((lines[0]![1] as { digest: string }).digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('noticing a change to a sealed day', () => {
  it('finds nothing when nothing was changed', async () => {
    await world();
    await runAuditDigestSweep(NIGHT);

    expect(await verifyAuditDigests()).toBeNull();
  });

  it('notices a row edited by somebody who switched the trigger off, and names the day', async () => {
    const { first } = await world();
    await runAuditDigestSweep(NIGHT);

    await asTheOwner(() =>
      prisma.$executeRaw`UPDATE audit.audit_log SET reason = 'Rewritten.' WHERE id = ${first.id}::uuid`,
    );

    expect(await verifyAuditDigests()).toMatchObject({ day: '2026-10-12', cause: 'changed', daysInDoubt: 4 });
  });

  it('notices a row removed', async () => {
    const { first } = await world();
    await runAuditDigestSweep(NIGHT);

    await asTheOwner(() => prisma.$executeRaw`DELETE FROM audit.audit_log WHERE id = ${first.id}::uuid`);
    expect(await verifyAuditDigests()).toMatchObject({ day: '2026-10-12' });
  });

  it('notices a row written into a day already sealed, which is how a past would be forged', async () => {
    await world();
    await runAuditDigestSweep(NIGHT);

    await rowAt('2026-10-13T12:00:00Z', { reason: 'Slipped into a day that was sealed empty.' });

    expect(await verifyAuditDigests()).toMatchObject({ day: '2026-10-13', cause: 'changed', daysInDoubt: 3 });
  });

  it('notices a day emptied altogether', async () => {
    await world();
    await runAuditDigestSweep(NIGHT);

    await asTheOwner(() => prisma.$executeRaw`DELETE FROM audit.audit_log WHERE created_at::date = '2026-10-14'`);

    expect(await verifyAuditDigests()).toMatchObject({ day: '2026-10-14' });
  });

  it('notices a change to what a row recorded as having happened', async () => {
    const { first } = await world();
    await runAuditDigestSweep(NIGHT);

    await asTheOwner(
      () => prisma.$executeRaw`UPDATE audit.audit_log SET after = '{"status":"ACTIVE"}'::jsonb WHERE id = ${first.id}::uuid`,
    );
    expect(await verifyAuditDigests()).toMatchObject({ day: '2026-10-12' });
  });

  it('notices a row moved to another hour of the same day', async () => {
    const { first } = await world();
    await runAuditDigestSweep(NIGHT);

    await asTheOwner(
      () => prisma.$executeRaw`UPDATE audit.audit_log SET created_at = created_at + interval '1 minute' WHERE id = ${first.id}::uuid`,
    );
    expect(await verifyAuditDigests()).toMatchObject({ day: '2026-10-12' });
  });

  it('is about sealed days only: a change to today’s rows is not what it vouches for yet', async () => {
    await world();
    await runAuditDigestSweep(NIGHT);

    await asTheOwner(() => prisma.$executeRaw`UPDATE audit.audit_log SET reason = 'Edited today.' WHERE created_at::date = '2026-10-16'`);

    expect(await verifyAuditDigests()).toBeNull();
  });

  it('fails the night’s run, loudly and by name, and still seals the new day', async () => {
    const error = vi.spyOn(logger, 'error');
    const { first } = await world();
    await runAuditDigestSweep(NIGHT);
    await asTheOwner(
      () => prisma.$executeRaw`UPDATE audit.audit_log SET reason = 'Rewritten.' WHERE id = ${first.id}::uuid`,
    );

    await expect(runAuditDigestSweep(new Date('2026-10-17T12:00:00Z'))).rejects.toThrow(AuditDigestMismatch);
    await expect(runAuditDigestSweep(new Date('2026-10-17T12:00:00Z'))).rejects.toThrow(/2026-10-12/);

    const lines = error.mock.calls.filter((call) => (call[1] as { event?: string } | undefined)?.event === 'audit_digest_mismatch');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]![1]).toMatchObject({ day: '2026-10-12', cause: 'changed' });
    // What went wrong is the day and the count, never what the row said.
    expect(JSON.stringify(lines[0]![1])).not.toContain('Rewritten');
    expect((await sealedDays()).map((row) => row.day)).toContain('2026-10-16');
  });
});

describe('the digests themselves', () => {
  it('cannot be changed or removed through the database either', async () => {
    await world();
    await runAuditDigestSweep(NIGHT);

    await expect(
      prisma.auditDigest.update({ where: { day: new Date('2026-10-12') }, data: { rowCount: 99 } }),
    ).rejects.toThrow(/audit_digests is append-only/);
    await expect(prisma.auditDigest.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await prisma.auditDigest.count()).toBe(4);
  });
});

describe('what a digest covers', () => {
  it('is every column the audit table has, so none can be added and left out of what is vouched for', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'audit' AND table_name = 'audit_log'`;

    expect(columns.map((column) => column.column_name).sort()).toEqual([...DIGESTED_COLUMNS].sort());
  });
});

describe('the nightly job', () => {
  const stub = { scheduledJob: { update: vi.fn(async () => ({})) } } as never;
  const job = { id: '00000000-0000-4000-8000-0000000000cc', key: 'audit.digest_sweep', interval_seconds: 86_400, run_count: 1 };

  it('is defined and has a handler, daily', () => {
    const definition = JOB_DEFINITIONS.find((candidate) => candidate.key === 'audit.digest_sweep');
    expect(definition?.intervalSeconds).toBe(24 * 60 * 60);
    expect(typeof jobs['audit.digest_sweep']).toBe('function');
  });

  it('succeeds on a trail that is as it was left, and fails on one that is not, with the day in the reason', async () => {
    const { first } = await world();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NIGHT);
    try {
      expect(await runJob(job, jobs, stub)).toBe('succeeded');

      await asTheOwner(
        () => prisma.$executeRaw`UPDATE audit.audit_log SET reason = 'Rewritten.' WHERE id = ${first.id}::uuid`,
      );
      expect(await runJob(job, jobs, stub)).toBe('failed');
    } finally {
      vi.useRealTimers();
    }

    const calls = (stub as { scheduledJob: { update: { mock: { calls: unknown[][] } } } }).scheduledJob.update.mock.calls;
    const last = calls[calls.length - 1]![0] as { data: { lastStatus: string; lastError: string } };
    expect(last.data.lastStatus).toBe('FAILED');
    expect(last.data.lastError).toContain('2026-10-12');
  });
});
