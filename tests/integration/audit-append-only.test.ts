import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';

/**
 * AUD-06 — the audit table is append-only because the database says so, not because nothing in
 * the application happens to change it.
 *
 * "No update or delete path exists in application code" was true and was the only thing standing
 * between a trail and a quiet edit: a one-line migration, a console session, a script run against
 * the wrong database, or a well-meant tidy-up of the `before` column would each have rewritten
 * history and nothing would have objected. These try each of those and expect the database to
 * refuse, and expect a refusal to leave the row exactly as it was.
 *
 * What it does not claim: a role that owns the table can drop the trigger, and TRUNCATE is left
 * alone because the test suite and the local reset script depend on it. This stops the careless
 * and the casual; it is not a defence against somebody who holds the owner's credentials, which
 * is what the nightly digest and keeping the trail somewhere the application cannot reach are for.
 */

async function writeOne(reason = 'A reason on the row.') {
  return prisma.$transaction((tx) =>
    recordAudit(tx, {
      action: 'user.suspended',
      entityType: 'identity.users',
      entityId: '00000000-0000-4000-8000-000000000001',
      reason,
      after: { status: 'SUSPENDED' },
    }),
  );
}

const REFUSAL = /append-only/;

describe('the audit table', () => {
  it('still takes new rows, which is all the application ever asks of it', async () => {
    const row = await writeOne();
    expect(await prisma.auditLog.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it('refuses an update through the application’s own client, and keeps the row as it was', async () => {
    const row = await writeOne('As written.');

    await expect(
      prisma.auditLog.update({ where: { id: row.id }, data: { reason: 'Rewritten.' } }),
    ).rejects.toThrow(REFUSAL);

    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: row.id } })).reason).toBe('As written.');
  });

  it('refuses a delete, one row or many', async () => {
    const row = await writeOne();
    await writeOne();

    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(REFUSAL);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(REFUSAL);

    expect(await prisma.auditLog.count()).toBe(2);
  });

  it('refuses hand-written SQL, which is how a script or a console session would do it', async () => {
    const row = await writeOne();

    await expect(
      prisma.$executeRaw`UPDATE audit.audit_log SET actor_id = NULL WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow(REFUSAL);
    await expect(
      prisma.$executeRaw`DELETE FROM audit.audit_log WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow(REFUSAL);
    // Even an update that changes nothing is a write to the trail, and is refused.
    await expect(
      prisma.$executeRaw`UPDATE audit.audit_log SET reason = reason WHERE id = ${row.id}::uuid`,
    ).rejects.toThrow(REFUSAL);
  });

  it('takes the whole transaction with it when something in it tries, so no act is half recorded', async () => {
    const row = await writeOne();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { phone: '+2348039990001', fullName: 'Should Not Exist' } });
        await tx.auditLog.update({ where: { id: row.id }, data: { reason: 'Rewritten.' } });
      }),
    ).rejects.toThrow(REFUSAL);

    expect(await prisma.user.count({ where: { phone: '+2348039990001' } })).toBe(0);
  });
});
