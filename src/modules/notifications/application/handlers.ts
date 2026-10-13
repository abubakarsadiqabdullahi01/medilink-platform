import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { watWindow } from '@/lib/wat';
import { notify, requireDelivered, type NotifyOutcome } from './notify';

/**
 * What a domain event turns into, for the people it concerns.
 *
 * Handlers must be idempotent: the outbox delivers at least once, and a
 * retried delivery must not send a second message. Each checks for a message
 * it has already *delivered* against the same assignment before sending.
 *
 * Handlers must also be honest about failure: if a text did not go they throw,
 * after trying everyone, so the outbox retries the event with backoff and, in
 * the end, parks it as a dead letter an operator can see (NOT-03).
 */

/**
 * Whether this person has already received this message. A row that failed
 * does not count: counting it meant a failed text blocked its own retry, and
 * a manual re-run sent nothing either.
 */
async function alreadyNotified(userId: string, kind: string, relatedId: string): Promise<boolean> {
  const existing = await prisma.notificationMessage.findFirst({
    where: { userId, kind, relatedId, sentAt: { not: null } },
    select: { id: true },
  });
  return existing !== null;
}

/** In West Africa Time, the clock on the ward and the one every screen uses. */
function formatShift(startsAt: Date, endsAt: Date): string {
  return watWindow(startsAt, endsAt);
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

  const when = formatShift(assignment.startsAt, assignment.endsAt);
  const outcomes: NotifyOutcome[] = [];

  if (!(await alreadyNotified(practitionerId, 'assignment.confirmed', assignmentId))) {
    outcomes.push(
      await notify({
        userId: practitionerId,
        kind: 'assignment.confirmed',
        body: `Your shift at ${facility.name} is confirmed: ${when}. Medilink.`,
        relatedType: 'matching.assignments',
        relatedId: assignmentId,
      }),
    );
  }

  // The representative stands for the facility. Once staff management lands,
  // this becomes whoever the facility has asked to be told.
  if (!(await alreadyNotified(facility.representativeUserId, 'assignment.confirmed', assignmentId))) {
    outcomes.push(
      await notify({
        userId: facility.representativeUserId,
        kind: 'assignment.confirmed',
        body: `A practitioner is confirmed for your shift on ${when}. Medilink.`,
        relatedType: 'matching.assignments',
        relatedId: assignmentId,
      }),
    );
  }

  requireDelivered(outcomes);
}

/**
 * The practitioner is told when a facility cancels a booking they held, one
 * way or the other: a single release, or the whole shift being cancelled.
 *
 * Only the practitioner — the facility did it, and was told by doing it. The
 * facility's reason stays in the booking's history; it is the facility's own
 * account of its business and the practitioner is told that it happened, not
 * why.
 */
export async function notifyAssignmentCancelled(payload: Record<string, unknown>): Promise<void> {
  const assignmentId = String(payload.assignmentId ?? '');
  const practitionerId = String(payload.userId ?? '');
  const facilityId = String(payload.facilityId ?? '');

  if (!assignmentId || !practitionerId || !facilityId) {
    logger.warn('assignment.cancelled event missing ids; skipping notification');
    return;
  }

  if (await alreadyNotified(practitionerId, 'assignment.cancelled', assignmentId)) return;

  const [facility, assignment] = await Promise.all([
    prisma.facility.findUnique({ where: { id: facilityId }, select: { name: true } }),
    prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  if (!facility || !assignment) {
    logger.warn('assignment.cancelled for a record that no longer exists', { assignmentId });
    return;
  }

  const when = formatShift(assignment.startsAt, assignment.endsAt);

  requireDelivered([
    await notify({
      userId: practitionerId,
      kind: 'assignment.cancelled',
      body: `Your shift at ${facility.name} on ${when} has been cancelled by the facility. You do not need to attend. Medilink.`,
      relatedType: 'matching.assignments',
      relatedId: assignmentId,
    }),
  ]);
}
