import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notify } from './notify';

/**
 * What a domain event turns into, for the people it concerns.
 *
 * Handlers must be idempotent: the outbox delivers at least once, and a
 * retried delivery must not send a second message. Each checks for a message
 * it has already recorded against the same assignment before sending.
 */

async function alreadyNotified(userId: string, kind: string, relatedId: string): Promise<boolean> {
  const existing = await prisma.notificationMessage.findFirst({
    where: { userId, kind, relatedId },
    select: { id: true },
  });
  return existing !== null;
}

function formatShift(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return `${start.toISOString().slice(0, 16).replace('T', ' ')} to ${end
    .toISOString()
    .slice(11, 16)} UTC`;
}

/**
 * Step 6.5: "both parties notified on confirm". The practitioner and the
 * facility's representative each get a message, and each is recorded.
 */
export async function notifyAssignmentConfirmed(payload: Record<string, unknown>): Promise<void> {
  const assignmentId = String(payload.assignmentId ?? '');
  const practitionerId = String(payload.userId ?? '');
  const facilityId = String(payload.facilityId ?? '');

  if (!assignmentId || !practitionerId || !facilityId) {
    logger.warn('assignment.confirmed event missing ids; skipping notification');
    return;
  }

  const [facility, assignment] = await Promise.all([
    prisma.facility.findUnique({
      where: { id: facilityId },
      select: { name: true, representativeUserId: true },
    }),
    prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  if (!facility || !assignment) {
    logger.warn('assignment.confirmed for a record that no longer exists', { assignmentId });
    return;
  }

  const when = formatShift(assignment.startsAt.toISOString(), assignment.endsAt.toISOString());

  if (!(await alreadyNotified(practitionerId, 'assignment.confirmed', assignmentId))) {
    await notify({
      userId: practitionerId,
      kind: 'assignment.confirmed',
      body: `Your shift at ${facility.name} is confirmed: ${when}. Medilink.`,
      relatedType: 'matching.assignments',
      relatedId: assignmentId,
    });
  }

  // The representative stands for the facility. Once staff management lands,
  // this becomes whoever the facility has asked to be told.
  if (!(await alreadyNotified(facility.representativeUserId, 'assignment.confirmed', assignmentId))) {
    await notify({
      userId: facility.representativeUserId,
      kind: 'assignment.confirmed',
      body: `A practitioner is confirmed for your shift on ${when}. Medilink.`,
      relatedType: 'matching.assignments',
      relatedId: assignmentId,
    });
  }
}
