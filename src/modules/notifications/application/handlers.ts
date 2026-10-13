import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { WAT_OFFSET_MINUTES } from '@/modules/availability/domain/availability';
import { notify, type NotifyOutcome } from './notify';

/**
 * What a domain event turns into, for the people it concerns.
 *
 * Handlers must be idempotent: the outbox delivers at least once, and a
 * retried delivery must not send a second message. Each checks for a message
 * it has already recorded against the same assignment before sending.
 */

/**
 * Whether this person has already been *told*. A failed attempt is on the
 * record too, and counting it here meant a retry found nothing to do and the
 * person was never told at all.
 */
async function alreadyNotified(userId: string, kind: string, relatedId: string): Promise<boolean> {
  const existing = await prisma.notificationMessage.findFirst({
    where: { userId, kind, relatedId, sentAt: { not: null } },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Lagos time, because that is the time on every other screen and the one the
 * reader is living in. These were printed in UTC, an hour behind, so a nurse
 * told "07:00" arrived to a ward that had expected her at 08:00.
 */
export function formatShift(startsAt: string, endsAt: string): string {
  const shift = (iso: string) => new Date(new Date(iso).getTime() + WAT_OFFSET_MINUTES * 60 * 1000);
  const start = shift(startsAt).toISOString();
  const end = shift(endsAt).toISOString();
  return `${start.slice(0, 10)} ${start.slice(11, 16)} to ${end.slice(11, 16)} WAT`;
}

/**
 * An outbox handler that tried to tell people and could not tell somebody
 * fails, so the event is retried rather than recorded as handled. Everybody
 * who was told is skipped on the retry (see `alreadyNotified`), so this costs
 * nobody a second message.
 */
function failIfAnyFailed(outcomes: NotifyOutcome[], what: string): void {
  const failed = outcomes.filter((outcome) => outcome === 'failed').length;
  if (failed > 0) throw new Error(`SMS delivery failed for ${failed} recipient(s) of ${what}.`);
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

  failIfAnyFailed(outcomes, 'the confirmation');
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

  const when = formatShift(assignment.startsAt.toISOString(), assignment.endsAt.toISOString());

  failIfAnyFailed(
    [
      await notify({
        userId: practitionerId,
        kind: 'assignment.cancelled',
        body: `Your shift at ${facility.name} on ${when} has been cancelled by the facility. You do not need to attend. Medilink.`,
        relatedType: 'matching.assignments',
        relatedId: assignmentId,
      }),
    ],
    'the cancellation',
  );
}
