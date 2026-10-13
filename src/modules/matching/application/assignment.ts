import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import { rateTermsFor } from '@/modules/rates-contracts/application/rate-card';
import {
  DEFAULT_INVITATION_HOURS,
  canTransitionAssignment,
  confirmBlockers,
  isInvitationOpen,
  type AssignmentStatusValue,
  type InvitationStatusValue,
} from '../domain/assignment';
import { isContactOpen } from '../domain/contact';
import { initialsOf } from '@/lib/names';
import type { AssignmentOutcomes } from '../domain/reliability';
import { recordDeclineAsSuggestion } from '@/modules/suggestions/application/suggestion';
import { getFacility } from '@/modules/facilities/application/facility';
import { bookingBlockers, bookingBlockersFor } from '@/modules/practitioners/application/bookable';

/**
 * Steps 6.5, 6.6 and 6.7: invitation, acceptance, confirmation — and the
 * conflict check that makes a double booking impossible rather than merely
 * unlikely.
 */

export const AssignmentErrors = {
  invitationNotFound: () =>
    new HttpError('invitation_not_found', 'That invitation does not exist.', 404),
  invitationClosed: () =>
    new HttpError('invitation_closed', 'That invitation is no longer open.', 409),
  requestNotPublished: () =>
    new HttpError('request_not_published', 'That request is not open for invitations.', 409),
  assignmentNotFound: () =>
    new HttpError('assignment_not_found', 'That assignment does not exist.', 404),
  shiftStarted: () => new HttpError('shift_started', 'That shift has already started.', 409),
  shiftEnded: () =>
    new HttpError(
      'shift_ended',
      'That shift is over, so it cannot be cancelled. Record what happened instead.',
      409,
    ),
  facilityNotActive: () =>
    new HttpError(
      'facility_not_verified',
      'This facility cannot offer work until it is verified and its licence is in date.',
      409,
    ),
  notBookable: (count: number) =>
    new HttpError(
      'practitioner_not_bookable',
      count === 1
        ? 'One of the people you chose can no longer be offered this shift: their verification, profession or consent no longer allows it. Run the match again.'
        : `${count} of the people you chose can no longer be offered this shift: their verification, profession or consent no longer allows it. Run the match again.`,
      409,
    ),
  cannotAccept: () =>
    new HttpError(
      'cannot_accept',
      'You cannot take this shift right now: your verification is incomplete or has lapsed. Open your profile to see what is outstanding.',
      409,
    ),
  cannotConfirm: (blockers: string[]) =>
    new HttpError('cannot_confirm', `This confirmation cannot proceed: ${blockers.join(', ')}.`, 409),
  invalidTransition: (from: string, to: string) =>
    new HttpError('invalid_transition', `A ${from} assignment cannot become ${to}.`, 409),
} as const;

export interface InvitationView {
  id: string;
  serviceRequestId: string;
  userId: string;
  status: InvitationStatusValue;
  /**
   * When the offer was made.
   *
   * On the view rather than only on the queue row because it belongs to the
   * invitation: the practitioner's offers list and the facility's "who have
   * we asked" list both want it, and the practitioner's screen was reading a
   * field nobody returned and rendering "offered —".
   *
   * It is also the one date that says whether an offer is going stale. An
   * expiry alone does not: an invitation sent an hour ago and one sent three
   * days ago can share a deadline.
   */
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  declineReason: string | null;
}

function toInvitationView(row: InvitationView): InvitationView {
  return {
    createdAt: row.createdAt,
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    userId: row.userId,
    status: row.status,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
    declineReason: row.declineReason,
  };
}

export interface InviteParams {
  requestId: string;
  facilityId: string;
  userIds: string[];
  matchRunId?: string;
  actorId: string;
  expiresInHours?: number;
}

/**
 * Invites the practitioners a facility chose from a match run.
 *
 * Chosen rather than invited automatically: step 9.4 requires every match to
 * be hand-reviewed for the first fifty engagements, so the platform ranks and
 * a person decides.
 */
export async function invitePractitioners(input: InviteParams): Promise<InvitationView[]> {
  const request = await prisma.serviceRequest.findFirst({
    where: { id: input.requestId, facilityId: input.facilityId, deletedAt: null },
  });
  if (!request) throw AssignmentErrors.assignmentNotFound();
  if (request.status !== 'PUBLISHED') throw AssignmentErrors.requestNotPublished();

  // Matching ran earlier; this is later. Everything it relied on is asked again —
  // a shift that has since started, a facility whose licence has since lapsed, a
  // practitioner whose registration has since expired or who has since withdrawn
  // consent — so a stale shortlist cannot put an offer in front of somebody who
  // could not now be matched.
  const now = new Date();
  if (request.startsAt.getTime() <= now.getTime()) throw AssignmentErrors.shiftStarted();
  if (!(await getFacility(request.facilityId)).canPublish) throw AssignmentErrors.facilityNotActive();
  const blockers = await bookingBlockersFor(input.userIds, request.professionalCategoryId, now);
  const refused = input.userIds.filter((userId) => (blockers.get(userId) ?? ['not_eligible']).length > 0);
  if (refused.length > 0) throw AssignmentErrors.notBookable(refused.length);

  const expiresAt = new Date(
    Date.now() + (input.expiresInHours ?? DEFAULT_INVITATION_HOURS) * 60 * 60 * 1000,
  );

  return prisma.$transaction(async (tx: Tx) => {
    const created: InvitationView[] = [];

    for (const userId of input.userIds) {
      const existing = await tx.invitation.findUnique({
        where: { serviceRequestId_userId: { serviceRequestId: request.id, userId } },
      });

      /**
       * Re-inviting somebody whose offer is still live is a no-op rather than
       * an error: a facility clicking twice should not fail. So is re-inviting
       * somebody who declined — that was their answer.
       *
       * An offer that closed *without* becoming an assignment is opened again
       * instead: withdrawn when the shift filled, or left to lapse. A filled
       * shift reopens when a confirmed practitioner drops out, and the people
       * it was withdrawn from are exactly who a scheduler asks next — returning
       * the dead row would tell the facility they had been asked when nothing
       * reached them.
       */
      const closedWithoutAnswer =
        existing !== null &&
        (existing.status === 'WITHDRAWN' ||
          existing.status === 'EXPIRED' ||
          (existing.status === 'INVITED' && !isInvitationOpen(existing)));

      if (existing && !closedWithoutAnswer) {
        created.push(toInvitationView(existing));
        continue;
      }

      if (existing) {
        const reopened = await tx.invitation.update({
          where: { id: existing.id },
          data: {
            status: 'INVITED',
            expiresAt,
            respondedAt: null,
            declineReason: null,
            // An acceptance of the earlier offer does not stand for this one.
            termsAccepted: Prisma.DbNull,
            invitedBy: input.actorId,
            matchRunId: input.matchRunId ?? existing.matchRunId,
          },
        });

        await recordAudit(tx, {
          action: 'assignment.reinvited',
          entityType: 'matching.invitations',
          entityId: reopened.id,
          actorId: input.actorId,
          scopeType: 'SELF',
          scopeId: userId,
          before: toInvitationView(existing),
          after: { serviceRequestId: request.id, status: 'INVITED', expiresAt },
        });

        await publishEvent(tx, {
          eventType: EVENTS.ShiftInvited,
          aggregateType: 'matching.invitations',
          aggregateId: reopened.id,
          payload: {
            invitationId: reopened.id,
            userId,
            serviceRequestId: request.id,
            // Tells one offer of the same invitation from the next: a reopened
            // invitation is the same row, and the person has to be told again.
            offeredAt: new Date().toISOString(),
          },
        });

        created.push(toInvitationView(reopened));
        continue;
      }

      const invitation = await tx.invitation.create({
        data: {
          serviceRequestId: request.id,
          userId,
          matchRunId: input.matchRunId,
          expiresAt,
          invitedBy: input.actorId,
        },
      });

      await recordAudit(tx, {
        action: 'assignment.invited',
        entityType: 'matching.invitations',
        entityId: invitation.id,
        actorId: input.actorId,
        // Scoped to the practitioner, not the facility: this is a thing that
        // happened to them, and they must see it in their own history.
        scopeType: 'SELF',
        scopeId: userId,
        after: { serviceRequestId: request.id, expiresAt },
      });

      await publishEvent(tx, {
        eventType: EVENTS.ShiftInvited,
        aggregateType: 'matching.invitations',
        aggregateId: invitation.id,
        payload: {
          invitationId: invitation.id,
          userId,
          serviceRequestId: request.id,
          offeredAt: new Date().toISOString(),
        },
      });

      created.push(toInvitationView(invitation));
    }

    return created;
  });
}

export interface RespondParams {
  invitationId: string;
  userId: string;
  decision: 'accept' | 'decline';
  reason?: string;
}

export async function respondToInvitation(input: RespondParams): Promise<InvitationView> {
  const invitation = await prisma.invitation.findFirst({
    where: { id: input.invitationId, userId: input.userId },
  });
  // Someone else's invitation is a 404, folding ownership into the lookup.
  if (!invitation) throw AssignmentErrors.invitationNotFound();
  if (!isInvitationOpen(invitation)) throw AssignmentErrors.invitationClosed();

  const now = new Date();
  const accepted = input.decision === 'accept';

  // Saying no is always possible. Saying yes is a commitment to a shift, so it is
  // checked against the world as it is now: the shift must still be open and the
  // practitioner still eligible, in the profession and consenting. Otherwise a
  // lapsed licence is accepted onto the shift and discovered at confirmation —
  // or not at all.
  let termsAccepted: Prisma.InputJsonValue | undefined;
  if (accepted) {
    const request = await prisma.serviceRequest.findFirst({
      where: { id: invitation.serviceRequestId, deletedAt: null },
      select: {
        status: true,
        startsAt: true,
        endsAt: true,
        professionalCategoryId: true,
        hourlyRateKobo: true,
        cancellationTerms: true,
        notes: true,
        facility: { select: { name: true, addressLine: true } },
      },
    });
    if (!request || request.status !== 'PUBLISHED') throw AssignmentErrors.invitationClosed();

    // What they were shown, copied at the moment they said yes. A dispute about
    // a late cancellation turns on what was agreed, and the request's own
    // columns say only what they say now.
    termsAccepted = {
      acceptedAt: now.toISOString(),
      facilityName: request.facility.name,
      addressLine: request.facility.addressLine,
      startsAt: request.startsAt.toISOString(),
      endsAt: request.endsAt.toISOString(),
      hourlyRateKobo: request.hourlyRateKobo,
      cancellationTerms: request.cancellationTerms,
      notes: request.notes,
    };
    if (request.startsAt.getTime() <= now.getTime()) throw AssignmentErrors.shiftStarted();
    if ((await bookingBlockers(input.userId, request.professionalCategoryId, now)).length > 0) {
      throw AssignmentErrors.cannotAccept();
    }
  }

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'INVITED' },
      data: {
        status: accepted ? 'ACCEPTED' : 'DECLINED',
        respondedAt: now,
        declineReason: accepted ? null : input.reason,
        ...(termsAccepted ? { termsAccepted } : {}),
      },
    });
    if (applied.count !== 1) throw AssignmentErrors.invitationClosed();

    const updated = await tx.invitation.findUniqueOrThrow({ where: { id: invitation.id } });

    await recordAudit(tx, {
      action: accepted ? 'assignment.invitation_accepted' : 'assignment.invitation_declined',
      entityType: 'matching.invitations',
      entityId: updated.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      reason: input.reason,
      before: toInvitationView(invitation),
      after: toInvitationView(updated),
    });

    // Step 9.5. A decline reason is already a practitioner saying why a shift
    // did not suit them, which is what the pilot's suggestion log is for —
    // in this transaction, so a decline and its suggestion are one write or
    // neither. The practitioner is not recorded as the author: they were
    // answering an invitation, not filing a suggestion.
    if (!accepted && input.reason) {
      await recordDeclineAsSuggestion(tx, {
        invitationId: updated.id,
        reason: input.reason,
      });
    }

    // Accepting is not being confirmed: the facility still decides, which is
    // why there is no event for a decline.
    if (accepted) {
      await publishEvent(tx, {
        eventType: EVENTS.ShiftAccepted,
        aggregateType: 'matching.invitations',
        aggregateId: updated.id,
        payload: {
          invitationId: updated.id,
          userId: input.userId,
          serviceRequestId: updated.serviceRequestId,
          acceptedAt: new Date().toISOString(),
        },
      });
    }

    return toInvitationView(updated);
  });
}

/**
 * Closes every offer on a request that will not become an assignment.
 *
 * Reached when a request fills, is cancelled or expires. Each leaves two kinds
 * of offer behind: one nobody answered, which the practitioner's offers page
 * would otherwise list as open indefinitely, and one they accepted that the
 * facility never confirmed — somebody told "accepted, the facility still has
 * to confirm you" who would never hear that the answer was no. Both become
 * WITHDRAWN, which is what the status exists for.
 *
 * Anyone who was ever confirmed onto the request keeps their accepted
 * invitation, whatever became of the assignment since — cancelled, completed
 * or a no-show. It did become an assignment, and it is the record of how they
 * got the place; relabelling it when the reopened shift later expires would
 * rewrite that history.
 *
 * Takes the caller's transaction, so the request's own change and the offers
 * closing with it are one write or neither.
 */
export async function withdrawOutstandingInvitations(
  tx: Tx,
  input: {
    requestId: string;
    actorId: string;
    actorType?: 'user' | 'system';
    reason: string;
    now?: Date;
  },
): Promise<number> {
  const assigned = await tx.assignment.findMany({
    where: { serviceRequestId: input.requestId },
    select: { userId: true },
  });
  const outstanding = await tx.invitation.findMany({
    where: {
      serviceRequestId: input.requestId,
      OR: [
        { status: 'INVITED' },
        { status: 'ACCEPTED', userId: { notIn: assigned.map((row) => row.userId) } },
      ],
    },
  });

  const now = input.now ?? new Date();
  let withdrawn = 0;

  for (const invitation of outstanding) {
    // Conditional on the status just read: a practitioner answering at this
    // moment either lands first and is withdrawn from what they chose, or
    // finds the offer already closed — never both.
    const applied = await tx.invitation.updateMany({
      where: { id: invitation.id, status: invitation.status },
      data: { status: 'WITHDRAWN', respondedAt: invitation.respondedAt ?? now },
    });
    if (applied.count !== 1) continue;
    withdrawn += 1;

    await recordAudit(tx, {
      action: 'assignment.invitation_withdrawn',
      entityType: 'matching.invitations',
      entityId: invitation.id,
      actorId: input.actorId,
      actorType: input.actorType,
      // Theirs to see in their own history, like the invitation itself.
      scopeType: 'SELF',
      scopeId: invitation.userId,
      reason: input.reason,
      before: toInvitationView(invitation),
      after: { status: 'WITHDRAWN' },
    });
  }

  return withdrawn;
}

export interface AssignmentView {
  id: string;
  serviceRequestId: string;
  userId: string;
  facilityId: string;
  startsAt: Date;
  endsAt: Date;
  status: AssignmentStatusValue;
  confirmedBy: string;
  createdAt: Date;
}

function toAssignmentView(row: AssignmentView): AssignmentView {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    userId: row.userId,
    facilityId: row.facilityId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    confirmedBy: row.confirmedBy,
    createdAt: row.createdAt,
  };
}

/**
 * Serialises confirmations for one practitioner.
 *
 * Step 6.7 requires that two overlapping confirmations, run concurrently,
 * produce exactly one assignment — a check-then-insert without this races and
 * produces two. An advisory lock rather than an `EXCLUDE USING gist`
 * constraint because Prisma's schema cannot express the latter, and
 * hand-written DDL inside a generated migration is drift this repository has
 * already chosen to avoid once.
 *
 * The lock is held to the end of the transaction and is keyed on the
 * practitioner, so confirmations for different people never wait on each
 * other.
 */
async function lockPractitioner(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
}

export interface ConfirmParams {
  requestId: string;
  facilityId: string;
  userId: string;
  actorId: string;
}

/**
 * Locks the request row for the rest of the transaction.
 *
 * The practitioner lock stops one person being double-booked; it does nothing for
 * the *request*. Two different practitioners hold two different practitioner
 * locks, so two confirmations onto the last place could both read "none filled"
 * and both insert — and at a headcount of two, both would see one short of full,
 * so the shift was never marked filled and later expired with a full roster.
 *
 * Always taken before the practitioner lock, never after: every confirmation
 * acquires its locks in this one order, so two of them can wait for each other's
 * request but never deadlock on each other's practitioner.
 */
async function lockRequest(tx: Tx, requestId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM service_requests.service_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
}

export async function confirmAssignment(input: ConfirmParams): Promise<AssignmentView> {
  const known = await prisma.serviceRequest.findFirst({
    where: { id: input.requestId, facilityId: input.facilityId, deletedAt: null },
  });
  if (!known) throw AssignmentErrors.assignmentNotFound();

  // The facility and the practitioner are re-checked at the moment of booking, not
  // trusted from the match that preceded it. Read before the transaction opens:
  // neither is something this booking can race against within its own lock.
  const now = new Date();
  const [facility, bookingBlockersNow, rateTerms] = await Promise.all([
    getFacility(known.facilityId),
    bookingBlockers(input.userId, known.professionalCategoryId, now),
    // The allowances in force for this shift's date, fixed on the booking. A
    // published shift's terms cannot change, so reading them before the locks is safe.
    rateTermsFor(known.facilityId, known.startsAt, now),
  ]);

  return prisma.$transaction(async (tx: Tx) => {
    await lockRequest(tx, known.id);
    await lockPractitioner(tx, input.userId);

    // Re-read under the lock. The copy read above predates it, so its status may
    // already be stale — a concurrent confirmation may just have filled the shift.
    const request = await tx.serviceRequest.findUniqueOrThrow({ where: { id: known.id } });

    // Everything below is read inside the locks, so what it sees cannot change
    // under it.
    const [invitation, confirmedCount, alreadyAssigned, conflicting] = await Promise.all([
      tx.invitation.findUnique({
        where: { serviceRequestId_userId: { serviceRequestId: request.id, userId: input.userId } },
        select: { status: true },
      }),
      tx.assignment.count({ where: { serviceRequestId: request.id, status: 'CONFIRMED' } }),
      tx.assignment.count({
        where: { serviceRequestId: request.id, userId: input.userId, status: 'CONFIRMED' },
      }),
      tx.assignment.count({
        where: {
          userId: input.userId,
          status: 'CONFIRMED',
          startsAt: { lt: request.endsAt },
          endsAt: { gt: request.startsAt },
        },
      }),
    ]);

    const blockers = confirmBlockers({
      requestStatus: request.status,
      shiftStarted: request.startsAt.getTime() <= now.getTime(),
      facilityActive: facility.canPublish,
      practitionerBookable: bookingBlockersNow.length === 0,
      headcount: request.headcount,
      confirmedCount,
      invitationStatus: invitation?.status ?? null,
      alreadyAssigned: alreadyAssigned > 0,
      hasConflict: conflicting > 0,
    });
    if (blockers.length > 0) throw AssignmentErrors.cannotConfirm(blockers);

    const assignment = await tx.assignment.create({
      data: {
        serviceRequestId: request.id,
        userId: input.userId,
        facilityId: request.facilityId,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        confirmedBy: input.actorId,
        // Priced on what applied when this was booked, not on whatever applies
        // when it is invoiced.
        rateTerms: { ...rateTerms },
      },
    });

    // Step 6.6: actor and reason are required columns, so no status change
    // can be written without both.
    await tx.assignmentStatusHistory.create({
      data: {
        assignmentId: assignment.id,
        fromStatus: null,
        toStatus: 'CONFIRMED',
        actorId: input.actorId,
        reason: 'Confirmed from an accepted invitation',
      },
    });

    await recordAudit(tx, {
      action: 'assignment.confirmed',
      entityType: 'matching.assignments',
      entityId: assignment.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.userId,
      after: toAssignmentView(assignment),
    });

    // The last confirmation closes the request, and every offer on it that
    // is not going to become an assignment closes with it.
    if (confirmedCount + 1 >= request.headcount) {
      await tx.serviceRequest.updateMany({
        where: { id: request.id, status: 'PUBLISHED' },
        data: { status: 'FILLED' },
      });

      const invitationsWithdrawn = await withdrawOutstandingInvitations(tx, {
        requestId: request.id,
        actorId: input.actorId,
        reason: 'The shift was filled before this offer became an assignment',
      });

      await recordAudit(tx, {
        action: 'service_request.filled',
        entityType: 'service_requests.service_requests',
        entityId: request.id,
        actorId: input.actorId,
        scopeType: 'FACILITY',
        scopeId: request.facilityId,
        after: { status: 'FILLED', confirmedCount: confirmedCount + 1, invitationsWithdrawn },
      });
    }

    await publishEvent(tx, {
      eventType: EVENTS.AssignmentConfirmed,
      aggregateType: 'matching.assignments',
      aggregateId: assignment.id,
      payload: {
        assignmentId: assignment.id,
        userId: input.userId,
        facilityId: request.facilityId,
        serviceRequestId: request.id,
        startsAt: request.startsAt.toISOString(),
        endsAt: request.endsAt.toISOString(),
      },
    });

    return toAssignmentView(assignment);
  });
}

export interface CancelAssignmentParams {
  assignmentId: string;
  facilityId: string;
  actorId: string;
  reason: string;
}

type AssignmentRow = NonNullable<Awaited<ReturnType<Tx['assignment']['findUnique']>>>;

/**
 * The one way a booking is cancelled, whether the facility is releasing one
 * person or cancelling the whole shift.
 *
 * Conditional on the status just read, so two cancellations arriving together
 * leave one history row, one audit row and one event rather than two of each;
 * the loser is told the booking is already cancelled. Publishes
 * `assignment.cancelled`, which is how the practitioner finds out — a booking
 * that vanishes from their schedule with no word is how a practitioner turns
 * up to a ward that no longer expects them.
 *
 * Returns the cancelled row, or null if somebody else got there first.
 */
async function cancelConfirmedBooking(
  tx: Tx,
  existing: AssignmentRow,
  input: { actorId: string; reason: string },
): Promise<AssignmentRow | null> {
  const applied = await tx.assignment.updateMany({
    where: { id: existing.id, status: 'CONFIRMED' },
    data: { status: 'CANCELLED' },
  });
  if (applied.count !== 1) return null;

  const updated = await tx.assignment.findUniqueOrThrow({ where: { id: existing.id } });

  await tx.assignmentStatusHistory.create({
    data: {
      assignmentId: updated.id,
      fromStatus: 'CONFIRMED',
      toStatus: 'CANCELLED',
      actorId: input.actorId,
      reason: input.reason,
    },
  });

  await recordAudit(tx, {
    action: 'assignment.cancelled',
    entityType: 'matching.assignments',
    entityId: updated.id,
    actorId: input.actorId,
    scopeType: 'SELF',
    scopeId: existing.userId,
    reason: input.reason,
    before: toAssignmentView(existing),
    after: toAssignmentView(updated),
  });

  // The reason is the facility's own record and stays in the history; the
  // practitioner is told that it happened, not why.
  await publishEvent(tx, {
    eventType: EVENTS.AssignmentCancelled,
    aggregateType: 'matching.assignments',
    aggregateId: updated.id,
    payload: {
      assignmentId: updated.id,
      userId: updated.userId,
      facilityId: updated.facilityId,
      serviceRequestId: updated.serviceRequestId,
      startsAt: updated.startsAt.toISOString(),
      endsAt: updated.endsAt.toISOString(),
    },
  });

  return updated;
}

/**
 * Takes one practitioner off a shift.
 *
 * Refused once the shift is over: at that point the question is what happened
 * — attended, absent, excused — and that belongs to attendance and the
 * no-show sweep, not to a cancellation that would rewrite it after the fact.
 */
export async function cancelAssignment(
  input: CancelAssignmentParams,
): Promise<AssignmentView> {
  const known = await prisma.assignment.findFirst({
    where: { id: input.assignmentId, facilityId: input.facilityId },
  });
  if (!known) throw AssignmentErrors.assignmentNotFound();
  if (known.status !== 'CONFIRMED') {
    throw AssignmentErrors.invalidTransition(known.status, 'CANCELLED');
  }
  if (known.endsAt.getTime() <= Date.now()) throw AssignmentErrors.shiftEnded();

  return prisma.$transaction(async (tx: Tx) => {
    // The request row first, so a cancellation and a confirmation on the same
    // shift queue behind one another — the order every booking write uses.
    if (known.serviceRequestId) await lockRequest(tx, known.serviceRequestId);

    const existing = await tx.assignment.findUniqueOrThrow({ where: { id: known.id } });
    if (existing.status !== 'CONFIRMED') {
      throw AssignmentErrors.invalidTransition(existing.status, 'CANCELLED');
    }

    const updated = await cancelConfirmedBooking(tx, existing, input);
    if (!updated) throw AssignmentErrors.invalidTransition('CANCELLED', 'CANCELLED');

    // Cancelling frees a place, so a filled request opens again.
    if (existing.serviceRequestId) {
      await tx.serviceRequest.updateMany({
        where: { id: existing.serviceRequestId, status: 'FILLED' },
        data: { status: 'PUBLISHED' },
      });
    }

    return toAssignmentView(updated);
  });
}

/**
 * Cancels every confirmed booking on a request, for the request's own
 * cancellation to call inside its transaction.
 *
 * Cancelling a shift that people were confirmed onto used to leave them
 * confirmed: still on their schedule, still able to check in, and once the
 * shift had passed, down as an absence an officer was asked to assign blame
 * for. The request is going away, so nothing is reopened here.
 */
export async function cancelBookingsForRequest(
  tx: Tx,
  input: { requestId: string; actorId: string; reason: string },
): Promise<number> {
  const live = await tx.assignment.findMany({
    where: { serviceRequestId: input.requestId, status: 'CONFIRMED' },
  });

  let cancelled = 0;
  for (const existing of live) {
    const done = await cancelConfirmedBooking(tx, existing, input);
    if (done) cancelled += 1;
  }
  return cancelled;
}

/**
 * One assignment, for another module to read.
 *
 * `attendance` and `timesheets` both need to know when a shift was scheduled
 * and who it belongs to. They reach it through here rather than by querying
 * `matching.assignments`, because a module never reads another module's
 * tables — the rule in docs/module-map.md.
 */
export async function getAssignment(assignmentId: string): Promise<AssignmentView | null> {
  const row = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  return row ? toAssignmentView(row) : null;
}

/**
 * What each of these bookings is priced on: the facility, when the shift starts,
 * and the allowances fixed when it was booked.
 *
 * For `timesheets`, which shows a facility what a shift will be billed and may
 * not read `matching.assignments` itself. One query for the whole page.
 */
export async function bookingTermsFor(
  assignmentIds: string[],
): Promise<Map<string, { facilityId: string; startsAt: Date; rateTerms: unknown }>> {
  if (assignmentIds.length === 0) return new Map();
  const rows = await prisma.assignment.findMany({
    where: { id: { in: assignmentIds } },
    select: { id: true, facilityId: true, startsAt: true, rateTerms: true },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      { facilityId: row.facilityId, startsAt: row.startsAt, rateTerms: row.rateTerms },
    ]),
  );
}

/**
 * Whether this facility has booked this person: a live, finished or no-show
 * assignment, but not one that was cancelled — a cancelled booking is a person
 * who never turned up on the ward.
 *
 * For modules that must not let a facility name just anybody (an incident
 * report can end in a suspension) and may not read `matching.assignments`
 * themselves.
 */
export async function isKnownToFacility(userId: string, facilityId: string): Promise<boolean> {
  const count = await prisma.assignment.count({
    where: { userId, facilityId, status: { in: ['CONFIRMED', 'COMPLETED', 'NO_SHOW'] } },
  });
  return count > 0;
}

export type ReadScopeType = 'SELF' | 'FACILITY' | 'PLATFORM';

/**
 * How many people are booked onto each of these requests, for lists that
 * show "2 of 3 filled".
 *
 * Every booking that was not cancelled counts, including ones that have since
 * completed or ended as a no-show: the place was taken either way, which is
 * the question a staffing board asks. `confirmAssignment` counts only live
 * CONFIRMED rows, because it asks a different question — whether there is
 * room for one more right now.
 *
 * The service-request list never carried this, and both the facility's
 * shifts board and its fulfilment chart read a field nobody returned, so
 * every shift showed nobody booked.
 */
export async function bookedCountsFor(requestIds: string[]): Promise<Map<string, number>> {
  if (requestIds.length === 0) return new Map();
  const rows = await prisma.assignment.groupBy({
    by: ['serviceRequestId'],
    where: { serviceRequestId: { in: requestIds }, status: { not: 'CANCELLED' } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.serviceRequestId, row._count._all]));
}

/**
 * The same assignment, but only when it is inside the scope the caller was
 * actually authorised for.
 *
 * The guard proves which scope somebody holds. It cannot know whether the
 * record named in a URL path belongs to that scope, and two read routes took
 * the id from the path while taking the scope from the query — so a
 * practitioner who declared their own SELF scope and somebody else's
 * assignment id was handed that person's hours, check-in times, device label
 * and pay. The guard was working; nothing was asking it about the right
 * record.
 *
 * Folding ownership into the lookup is the rule `loadForFacility` already
 * follows in service-requests, and the refusal is a 404 for the same reason it
 * gives there: a distinguishable 403 would confirm the id exists.
 */
export async function getAssignmentInScope(input: {
  assignmentId: string;
  scopeType: ReadScopeType;
  scopeId?: string;
}): Promise<AssignmentView> {
  const assignment = await getAssignment(input.assignmentId);
  if (!assignment) throw AssignmentErrors.assignmentNotFound();

  if (input.scopeType === 'SELF' && assignment.userId !== input.scopeId) {
    throw AssignmentErrors.assignmentNotFound();
  }
  if (input.scopeType === 'FACILITY' && assignment.facilityId !== input.scopeId) {
    throw AssignmentErrors.assignmentNotFound();
  }

  // PLATFORM is deliberately unrestricted: a grant at PLATFORM is the one that
  // is meant to reach every facility and every practitioner.
  return assignment;
}

/**
 * Reached when an approved timesheet says the shift was worked (step 7.5).
 * `COMPLETED` has been in the enum since Stage 6 with nothing setting it, and
 * this is what ends cold start for the reliability score.
 */
export async function markAssignmentCompleted(input: {
  assignmentId: string;
  actorId: string;
  reason: string;
}): Promise<AssignmentView> {
  const existing = await prisma.assignment.findUnique({ where: { id: input.assignmentId } });
  if (!existing) throw AssignmentErrors.assignmentNotFound();

  // Already there, so there is nothing to do and nothing wrong. A timesheet
  // approved, disputed, upheld and approved again arrives here twice: the
  // hours were in question, not whether the shift happened, so the assignment
  // stayed completed throughout and completing it again is a no-op rather
  // than an illegal move. Returning early keeps `assignment.completed` from
  // appearing twice in the history for one shift.
  if (existing.status === 'COMPLETED') return toAssignmentView(existing);

  if (!canTransitionAssignment(existing.status, 'COMPLETED')) {
    throw AssignmentErrors.invalidTransition(existing.status, 'COMPLETED');
  }

  return prisma.$transaction(async (tx: Tx) => {
    const updated = await tx.assignment.update({
      where: { id: existing.id },
      data: { status: 'COMPLETED' },
    });

    await tx.assignmentStatusHistory.create({
      data: {
        assignmentId: updated.id,
        fromStatus: existing.status,
        toStatus: 'COMPLETED',
        actorId: input.actorId,
        reason: input.reason,
      },
    });

    await recordAudit(tx, {
      action: 'assignment.completed',
      entityType: 'matching.assignments',
      entityId: updated.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: existing.userId,
      reason: input.reason,
      before: toAssignmentView(existing),
      after: toAssignmentView(updated),
    });

    return toAssignmentView(updated);
  });
}

/**
 * What this practitioner's finished assignments came to. Cold start and the
 * reliability factor both read this, and until Stage 7 approved a timesheet
 * there was nothing here to read.
 */
export async function assignmentOutcomes(userId: string): Promise<AssignmentOutcomes> {
  const outcomes = await assignmentOutcomesFor([userId]);
  return outcomes.get(userId) ?? { completed: 0, noShow: 0 };
}

/**
 * The same counts for a shortlist, as one grouped query.
 *
 * Reliability is wanted for every candidate in a match run, and the
 * single-user version is two counts each — four hundred queries to rank two
 * hundred people. Grouping asks the database to do the counting it is good
 * at, once.
 *
 * Everybody asked about is in the map, at zero if they have no finished
 * assignments: a practitioner who has never worked a shift has a real
 * reliability answer, and it is not the same as not having been asked.
 */
export async function assignmentOutcomesFor(
  userIds: string[],
): Promise<Map<string, AssignmentOutcomes>> {
  const outcomes = new Map<string, AssignmentOutcomes>();
  if (userIds.length === 0) return outcomes;

  const ids = [...new Set(userIds)];
  for (const id of ids) outcomes.set(id, { completed: 0, noShow: 0 });

  const grouped = await prisma.assignment.groupBy({
    by: ['userId', 'status'],
    where: { userId: { in: ids }, status: { in: ['COMPLETED', 'NO_SHOW'] } },
    _count: { _all: true },
  });

  for (const row of grouped) {
    const current = outcomes.get(row.userId);
    if (!current) continue;
    if (row.status === 'COMPLETED') current.completed = row._count._all;
    if (row.status === 'NO_SHOW') current.noShow = row._count._all;
  }

  return outcomes;
}

/** How many shifts this practitioner has actually completed. */
export async function countCompletedAssignments(userId: string): Promise<number> {
  return prisma.assignment.count({ where: { userId, status: 'COMPLETED' } });
}

export interface InvitationQueueRow extends InvitationView {
  facilityName: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  shiftType: string;
  hourlyRateKobo: number;
  urgency: string;
  startsAt: Date;
  endsAt: Date;
  /** What a dispute turns on, shown before the practitioner says yes. */
  cancellationTerms: string;
  notes: string | null;
  addressLine: string;
  headcount: number;
}

/**
 * A practitioner's own offers, with what they'd actually need to decide —
 * where, when, what kind of shift and what it pays. The bare invitation row
 * has none of that; only `serviceRequestId` says which shift it is at all.
 *
 * `Invitation` carries no Prisma relation to `ServiceRequest` — unlike
 * `Assignment`, which does — so this is a second query and a merge by id
 * rather than an `include`, the same shape `read-audit-trail.ts` uses to
 * name an actor.
 */
export async function listInvitationsFor(userId: string): Promise<InvitationQueueRow[]> {
  const rows = await prisma.invitation.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  const requestIds = [...new Set(rows.map((row) => row.serviceRequestId))];
  const requests = requestIds.length
    ? await prisma.serviceRequest.findMany({
        where: { id: { in: requestIds }, deletedAt: null },
        select: {
          id: true,
          professionalCategoryId: true,
          specialtyId: true,
          shiftType: true,
          hourlyRateKobo: true,
          urgency: true,
          startsAt: true,
          endsAt: true,
          cancellationTerms: true,
          notes: true,
          headcount: true,
          facility: { select: { name: true, addressLine: true } },
        },
      })
    : [];
  const byId = new Map(requests.map((request) => [request.id, request]));

  return rows.flatMap((row) => {
    const request = byId.get(row.serviceRequestId);
    // The shift itself was hard-deleted or is otherwise unreachable — leave
    // the invitation out rather than show an offer with nothing on it.
    if (!request) return [];
    return [
      {
        ...toInvitationView(row),
        facilityName: request.facility.name,
        professionalCategoryId: request.professionalCategoryId,
        specialtyId: request.specialtyId,
        shiftType: request.shiftType,
        hourlyRateKobo: request.hourlyRateKobo,
        urgency: request.urgency,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        cancellationTerms: request.cancellationTerms,
        notes: request.notes,
        addressLine: request.facility.addressLine,
        headcount: request.headcount,
      },
    ];
  });
}

export interface RequestInvitationRow extends InvitationView {
  practitionerName: string;
}

/**
 * Everybody a facility has offered one shift to, and what each answered.
 *
 * The shift page used to keep the offers it had just sent in component state
 * and nowhere else, while telling the scheduler to "refresh after they
 * answer, then confirm below" — and a refresh emptied that state, taking the
 * Offered and Ready-to-confirm lists with it. An accepted offer could then
 * only be confirmed by somebody who had never left the page. The offers are
 * rows in the database; this reads them.
 *
 * A request belonging to another facility is absent rather than forbidden:
 * the caller has already proved they may read *this* facility.
 */
export async function listInvitationsForRequest(input: {
  requestId: string;
  facilityId: string;
}): Promise<RequestInvitationRow[]> {
  const request = await prisma.serviceRequest.findFirst({
    where: { id: input.requestId, facilityId: input.facilityId, deletedAt: null },
    select: { id: true },
  });
  if (!request) throw AssignmentErrors.assignmentNotFound();

  const rows = await prisma.invitation.findMany({
    where: { serviceRequestId: request.id },
    orderBy: { createdAt: 'asc' },
  });

  // identity.users is the shared primitive every module names people from.
  const users = rows.length
    ? await prisma.user.findMany({
        where: { id: { in: rows.map((row) => row.userId) } },
        select: { id: true, fullName: true },
      })
    : [];
  const names = new Map(users.map((user) => [user.id, user.fullName]));

  // Whoever has said yes is named, because the facility has to confirm them. Whoever
  // has only been invited (or declined, or let it lapse) is initials: an offer is not a
  // booking, and a name is what a booking releases. The decline reason is not returned
  // at all — the practitioner's screen promises it "reaches the platform without your
  // name", and an API that hands it to the facility breaks that whatever the page renders.
  return rows.map((row) => ({
    ...toInvitationView(row),
    declineReason: null,
    practitionerName:
      row.status === 'ACCEPTED'
        ? (names.get(row.userId) ?? 'Unknown practitioner')
        : initialsOf(names.get(row.userId) ?? ''),
  }));
}

export interface ListAssignmentsQuery {
  scopeType: 'SELF' | 'FACILITY';
  scopeId: string;
  status?: AssignmentStatusValue;
  serviceRequestId?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  cursor?: string;
}

export interface AssignmentQueueRow extends AssignmentView {
  practitionerName: string;
  practitionerPhone: string;
  facilityName: string;
  shiftType: string;
  hourlyRateKobo: number;
}

export interface AssignmentsPage {
  assignments: AssignmentQueueRow[];
  nextCursor: string | null;
}

/**
 * The schedule: a practitioner's own, or a facility's whole roster — named,
 * searchable and paged.
 *
 * The roster was showing a fragment of a uuid where a practitioner's name
 * belongs, the same gap `listUnhonoured` and `listDisputes` had closed for
 * their own queues — the one screen a ward manager actually reads every
 * morning still had it. `search` is meaningless at SELF scope (nobody
 * searches their own single name) and quietly ignored there rather than
 * refused, so the same query shape works for both scopes without a caller
 * having to know which one it is.
 */
export async function listAssignments(query: ListAssignmentsQuery): Promise<AssignmentsPage> {
  // Matches the schema's own default — see its comment: several existing
  // callers read this list's length as a count and pass no limit at all.
  const limit = query.limit ?? 200;
  const where: Prisma.AssignmentWhereInput =
    query.scopeType === 'SELF' ? { userId: query.scopeId } : { facilityId: query.scopeId };
  if (query.status) where.status = query.status;
  if (query.serviceRequestId) where.serviceRequestId = query.serviceRequestId;
  if (query.from || query.to) {
    where.startsAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }

  if (query.scopeType === 'FACILITY' && query.search) {
    const search = query.search.trim();
    // By name only. Searching by number would let a facility test whether a number it
    // already holds belongs to somebody on its roster, which defeats withholding it.
    where.user = { fullName: { contains: search, mode: 'insensitive' } };
  }

  const rows = await prisma.assignment.findMany({
    where,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: {
      user: { select: { fullName: true, phone: true } },
      serviceRequest: {
        select: {
          shiftType: true,
          hourlyRateKobo: true,
          facility: { select: { name: true } },
        },
      },
    },
  });

  const page = rows.slice(0, limit);
  const now = new Date();
  const assignments = page.map((row) => ({
    ...toAssignmentView(row),
    practitionerName: row.user.fullName,
    // Their own number is always theirs. A facility sees it only around the shift.
    practitionerPhone:
      query.scopeType === 'SELF' ||
      isContactOpen({ status: row.status, startsAt: row.startsAt, endsAt: row.endsAt, now })
        ? row.user.phone
        : '',
    facilityName: row.serviceRequest.facility.name,
    shiftType: row.serviceRequest.shiftType,
    hourlyRateKobo: row.serviceRequest.hourlyRateKobo,
  }));

  return {
    assignments,
    nextCursor: rows.length > limit ? (assignments[assignments.length - 1]?.id ?? null) : null,
  };
}

export interface StatusHistoryEntry {
  fromStatus: AssignmentStatusValue | null;
  toStatus: AssignmentStatusValue;
  actorId: string;
  reason: string;
  createdAt: Date;
}

export async function assignmentHistory(assignmentId: string): Promise<StatusHistoryEntry[]> {
  const rows = await prisma.assignmentStatusHistory.findMany({
    where: { assignmentId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    actorId: row.actorId,
    reason: row.reason,
    createdAt: row.createdAt,
  }));
}

/**
 * Assignments still CONFIRMED whose shift has already ended.
 *
 * The unhonoured sweep in `cancellations-sanctions` starts from this list and
 * then asks attendance which of them show any sign of having happened. Both
 * halves go through their own module's application layer.
 */
export async function listEndedConfirmedAssignments(before: Date): Promise<AssignmentView[]> {
  const rows = await prisma.assignment.findMany({
    where: { status: 'CONFIRMED', endsAt: { lt: before } },
    orderBy: { endsAt: 'asc' },
  });
  return rows.map(toAssignmentView);
}

/**
 * Closes an assignment nobody honoured, once a person has decided the fault.
 *
 * Practitioner fault is the only thing that produces a NO_SHOW; everything
 * else lands on CANCELLED. The caller decides which — this only writes it,
 * with the actor and the reason the history column requires, and publishes
 * the event when a no-show is what it turned out to be.
 */
export async function settleUnhonouredAssignment(input: {
  assignmentId: string;
  outcome: Extract<AssignmentStatusValue, 'NO_SHOW' | 'CANCELLED'>;
  actorId: string;
  reason: string;
}): Promise<AssignmentView> {
  const current = await prisma.assignment.findUnique({ where: { id: input.assignmentId } });
  if (!current) throw AssignmentErrors.assignmentNotFound();

  const from = current.status as AssignmentStatusValue;
  if (!canTransitionAssignment(from, input.outcome)) {
    throw AssignmentErrors.invalidTransition(from, input.outcome);
  }

  return prisma.$transaction(async (tx: Tx) => {
    // Compare-and-set on the status we checked, so two officers deciding at
    // once cannot both write a finding.
    const applied = await tx.assignment.updateMany({
      where: { id: input.assignmentId, status: from },
      data: { status: input.outcome },
    });
    if (applied.count !== 1) throw AssignmentErrors.invalidTransition(from, input.outcome);

    const updated = await tx.assignment.findUniqueOrThrow({ where: { id: input.assignmentId } });

    await tx.assignmentStatusHistory.create({
      data: {
        assignmentId: input.assignmentId,
        fromStatus: from,
        toStatus: input.outcome,
        actorId: input.actorId,
        reason: input.reason,
      },
    });

    await recordAudit(tx, {
      action: input.outcome === 'NO_SHOW' ? 'assignment.no_show' : 'assignment.cancelled',
      entityType: 'matching.assignments',
      entityId: input.assignmentId,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: updated.facilityId,
      reason: input.reason,
      before: toAssignmentView(current),
      after: toAssignmentView(updated),
    });

    if (input.outcome === 'NO_SHOW') {
      await publishEvent(tx, {
        eventType: EVENTS.NoShowRecorded,
        aggregateType: 'matching.assignments',
        aggregateId: input.assignmentId,
        payload: {
          assignmentId: input.assignmentId,
          userId: updated.userId,
          facilityId: updated.facilityId,
          reason: input.reason,
        },
      });
    }

    return toAssignmentView(updated);
  });
}
