import { beforeEach, describe, expect, it, vi } from 'vitest';

// The bucket is not available to these tests; what matters is which files were
// asked to be deleted, and what happens when one cannot be.
const deleteObject = vi.hoisted(() => vi.fn<(key: string) => Promise<void>>(async () => {}));
vi.mock('@/lib/storage/tigris', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage/tigris')>()),
  deleteObject,
}));

import { prisma } from '@/lib/db';
import { purgeExpiredData } from '@/modules/audit-compliance/application/retention';
import { purgeDaysFor } from '@/modules/audit-compliance/domain/data-inventory';
import { JOB_DEFINITIONS, jobs } from '@/worker/jobs';
import { createUser } from './support/fixtures';

/**
 * AUD-04. Nothing deleted anything: one-time codes, finished sessions, sign-in
 * attempts, processed queue entries and abandoned uploads all stayed for ever,
 * and the people they described never knew.
 *
 * What the job removes is only what no obligation could want kept, on the
 * periods the inventory proposes. The other half of each case is as important
 * as the first: a recent row, a live row and a row somebody still has to act on
 * must survive, because a purge that over-deletes is worse than none.
 */

const NOW = new Date('2026-10-14T12:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

beforeEach(() => {
  deleteObject.mockClear();
  deleteObject.mockImplementation(async () => {});
});

async function otp(userId: string, createdAt: Date) {
  return prisma.otpCode.create({
    data: {
      userId,
      purpose: 'LOGIN',
      codeHash: 'x',
      expiresAt: new Date(createdAt.getTime() + 600_000),
      createdAt,
    },
  });
}

let tokenCounter = 0;
async function session(
  userId: string,
  input: { expiresAt: Date; revokedAt?: Date; createdAt?: Date },
) {
  tokenCounter += 1;
  return prisma.session.create({
    data: {
      userId,
      tokenHash: `hash-${tokenCounter}`,
      expiresAt: input.expiresAt,
      revokedAt: input.revokedAt,
      createdAt: input.createdAt ?? daysAgo(100),
    },
  });
}

let eventCounter = 0;
async function outbox(input: { status: 'PENDING' | 'PROCESSED' | 'FAILED' | 'DEAD_LETTER'; processedAt?: Date }) {
  eventCounter += 1;
  return prisma.outboxEvent.create({
    data: {
      eventType: 'test.event',
      aggregateType: 'test',
      aggregateId: `agg-${eventCounter}`,
      payload: {},
      status: input.status,
      processedAt: input.processedAt,
      createdAt: daysAgo(100),
    },
  });
}

let objectCounter = 0;
async function stored(input: { uploadedAt?: Date; createdAt: Date; deletedAt?: Date }) {
  objectCounter += 1;
  return prisma.storedObject.create({
    data: {
      bucket: 'test',
      objectKey: `credential_document/202610/u/${objectCounter}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 100,
      purpose: 'credential_document',
      uploadedAt: input.uploadedAt,
      createdAt: input.createdAt,
      deletedAt: input.deletedAt,
    },
  });
}

describe('one-time codes', () => {
  it('removes codes past their retention and keeps recent ones', async () => {
    const user = await createUser();
    const old = await otp(user.id, daysAgo(purgeDaysFor('sign_in_codes') + 1));
    const recent = await otp(user.id, hoursAgo(1));

    const report = await purgeExpiredData({ now: NOW });

    expect(report.deleted.sign_in_codes).toBe(1);
    expect(await prisma.otpCode.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.otpCode.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});

describe('sessions', () => {
  const days = () => purgeDaysFor('sessions');

  it('removes sessions that ended long enough ago, by expiry or by revocation', async () => {
    const user = await createUser();
    const expired = await session(user.id, { expiresAt: daysAgo(days() + 1) });
    const revoked = await session(user.id, {
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      revokedAt: daysAgo(days() + 1),
    });

    const report = await purgeExpiredData({ now: NOW });

    expect(report.deleted.sessions).toBe(2);
    expect(await prisma.session.count({ where: { id: { in: [expired.id, revoked.id] } } })).toBe(0);
  });

  it('keeps a session that only recently ended, and one that is still live however old', async () => {
    const user = await createUser();
    const recentlyEnded = await session(user.id, { expiresAt: daysAgo(days() - 1) });
    const recentlyRevoked = await session(user.id, {
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      revokedAt: daysAgo(1),
    });
    const live = await session(user.id, {
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      createdAt: daysAgo(400),
    });

    await purgeExpiredData({ now: NOW });

    expect(
      await prisma.session.count({ where: { id: { in: [recentlyEnded.id, recentlyRevoked.id, live.id] } } }),
    ).toBe(3);
  });
});

describe('sign-in attempts', () => {
  it('removes attempts past their retention, whoever they were, and keeps recent ones', async () => {
    const days = purgeDaysFor('sign_in_attempts');
    await prisma.loginAttempt.create({
      data: { identifier: '+2348031111111', succeeded: false, createdAt: daysAgo(days + 1) },
    });
    await prisma.loginAttempt.create({
      data: { identifier: '+2348032222222', succeeded: true, createdAt: daysAgo(days + 30) },
    });
    const recent = await prisma.loginAttempt.create({
      data: { identifier: '+2348033333333', succeeded: false, createdAt: daysAgo(1) },
    });

    const report = await purgeExpiredData({ now: NOW });

    expect(report.deleted.sign_in_attempts).toBe(2);
    expect(await prisma.loginAttempt.findMany()).toEqual([expect.objectContaining({ id: recent.id })]);
  });
});

describe('the background queue', () => {
  it('removes entries that were processed long ago, and only those', async () => {
    const days = purgeDaysFor('background_queue');
    const old = await outbox({ status: 'PROCESSED', processedAt: daysAgo(days + 1) });
    const recent = await outbox({ status: 'PROCESSED', processedAt: daysAgo(1) });
    // Somebody still has to look at these however long they have sat.
    // Even one that carries an old processing time from an earlier attempt.
    const failed = await outbox({ status: 'FAILED', processedAt: daysAgo(days + 10) });
    const dead = await outbox({ status: 'DEAD_LETTER', processedAt: daysAgo(days + 10) });
    const waiting = await outbox({ status: 'PENDING' });

    const report = await purgeExpiredData({ now: NOW });

    expect(report.deleted.background_queue).toBe(1);
    expect(await prisma.outboxEvent.findUnique({ where: { id: old.id } })).toBeNull();
    const kept = await prisma.outboxEvent.findMany({ select: { id: true } });
    expect(kept.map((row) => row.id).sort()).toEqual([recent.id, failed.id, dead.id, waiting.id].sort());
  });
});

describe('abandoned uploads', () => {
  const days = () => purgeDaysFor('abandoned_uploads');

  it('deletes the file and marks the row for an upload nobody finished', async () => {
    const abandoned = await stored({ createdAt: daysAgo(days() + 1) });

    const report = await purgeExpiredData({ now: NOW });

    expect(deleteObject).toHaveBeenCalledWith(abandoned.objectKey);
    expect(report.files).toEqual({ deleted: 1, pending: 0 });
    const row = await prisma.storedObject.findUniqueOrThrow({ where: { id: abandoned.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it('leaves a finished upload, and one that is only recently begun', async () => {
    const finished = await stored({ createdAt: daysAgo(days() + 30), uploadedAt: daysAgo(days() + 30) });
    const recent = await stored({ createdAt: hoursAgo(1) });

    await purgeExpiredData({ now: NOW });

    expect(deleteObject).not.toHaveBeenCalled();
    expect(
      (await prisma.storedObject.findMany({ where: { id: { in: [finished.id, recent.id] } } })).every(
        (row) => row.deletedAt === null,
      ),
    ).toBe(true);
  });

  it('leaves the row to be tried again when the file cannot be deleted', async () => {
    const abandoned = await stored({ createdAt: daysAgo(days() + 1) });
    deleteObject.mockRejectedValueOnce(new Error('storage unreachable'));

    const first = await purgeExpiredData({ now: NOW });

    expect(first.files).toEqual({ deleted: 0, pending: 1 });
    expect((await prisma.storedObject.findUniqueOrThrow({ where: { id: abandoned.id } })).deletedAt).toBeNull();

    const second = await purgeExpiredData({ now: NOW });

    expect(second.files).toEqual({ deleted: 1, pending: 0 });
    expect((await prisma.storedObject.findUniqueOrThrow({ where: { id: abandoned.id } })).deletedAt).not.toBeNull();
  });

  it('does not touch a row that was already deleted', async () => {
    await stored({ createdAt: daysAgo(days() + 5), deletedAt: daysAgo(2) });

    const report = await purgeExpiredData({ now: NOW });

    expect(deleteObject).not.toHaveBeenCalled();
    expect(report.files).toEqual({ deleted: 0, pending: 0 });
  });
});

describe('the record of having purged', () => {
  it('writes one audit row with counts and nothing that names anybody', async () => {
    const user = await createUser({ fullName: 'Amina Yusuf' });
    await otp(user.id, daysAgo(purgeDaysFor('sign_in_codes') + 1));
    await prisma.loginAttempt.create({
      data: { identifier: '+2348031234567', succeeded: false, createdAt: daysAgo(purgeDaysFor('sign_in_attempts') + 1) },
    });

    await purgeExpiredData({ now: NOW });

    const rows = await prisma.auditLog.findMany({ where: { action: 'retention.purged' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorType).toBe('worker');
    const written = JSON.stringify(rows[0]);
    expect(written).toContain('sign_in_codes');
    for (const personal of ['Amina', '8031234567', user.id]) expect(written).not.toContain(personal);
  });

  it('writes nothing on a day there was nothing to purge, so the trail is not filled with silence', async () => {
    const report = await purgeExpiredData({ now: NOW });

    expect(report.deleted).toEqual({});
    expect(await prisma.auditLog.count({ where: { action: 'retention.purged' } })).toBe(0);
  });

  it('finds nothing the second time', async () => {
    const user = await createUser();
    await otp(user.id, daysAgo(purgeDaysFor('sign_in_codes') + 1));

    await purgeExpiredData({ now: NOW });
    const again = await purgeExpiredData({ now: NOW });

    expect(again.deleted).toEqual({});
    expect(await prisma.auditLog.count({ where: { action: 'retention.purged' } })).toBe(1);
  });
});

describe('running on a schedule', () => {
  it('is a scheduled job with a handler, so it actually runs', () => {
    expect(JOB_DEFINITIONS.map((job) => job.key)).toContain('retention.purge_sweep');
    expect(typeof jobs['retention.purge_sweep']).toBe('function');
  });
});
