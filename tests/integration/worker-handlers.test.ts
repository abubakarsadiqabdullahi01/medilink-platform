import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { publishEvent } from '@/lib/outbox';
import { handlers } from '@/worker/handlers';
import { runOnce } from '@/worker/processor';
import { createUser, ensureRole } from './support/fixtures';

/**
 * Business behaviour of the registered event handlers themselves — as
 * opposed to tests/integration/outbox.test.ts, which tests delivery
 * mechanics (retry, backoff, dead-letter) using PractitionerRegistered only
 * as a convenient stand-in event type.
 *
 * Closes a real gap: nothing previously granted any role to a newly
 * registered user, so a practitioner had zero permissions to exercise. See
 * src/modules/practitioners/application/role-grants.ts.
 */

async function makeDue(id: string): Promise<void> {
  await prisma.outboxEvent.update({
    where: { id },
    data: { availableAt: new Date(Date.now() - 1000) },
  });
}

describe('practitioner.registered grants the baseline role', () => {
  it('grants practitioner at SELF scope exactly once, even across a retried delivery', async () => {
    await ensureRole('practitioner');
    const user = await createUser();

    const event = await prisma.$transaction((tx) =>
      publishEvent(tx, {
        eventType: EVENTS.PractitionerRegistered,
        aggregateType: 'identity.users',
        aggregateId: user.id,
        payload: { userId: user.id },
      }),
    );

    await runOnce({ handlers });

    const grants = await prisma.userRole.findMany({
      where: { userId: user.id, scopeType: 'SELF', scopeId: user.id },
    });
    expect(grants).toHaveLength(1);

    const auditRows = await prisma.auditLog.findMany({ where: { action: 'auth.role_granted' } });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.entityId).toBe(grants[0]?.id);

    // Simulate the outbox's at-least-once delivery: rewind and reprocess.
    await makeDue(event.id);
    await runOnce({ handlers });

    const grantsAfterRetry = await prisma.userRole.findMany({
      where: { userId: user.id, scopeType: 'SELF', scopeId: user.id },
    });
    expect(grantsAfterRetry).toHaveLength(1);

    const auditRowsAfterRetry = await prisma.auditLog.findMany({ where: { action: 'auth.role_granted' } });
    expect(auditRowsAfterRetry).toHaveLength(1);
  });
});
