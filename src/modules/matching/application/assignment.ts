import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import {
  DEFAULT_INVITATION_HOURS,
  canTransitionAssignment,
  confirmBlockers,
  isInvitationOpen,
  type AssignmentStatusValue,
  type InvitationStatusValue,
} from '../domain/assignment';
import type { AssignmentOutcomes } from '../domain/reliability';

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
  expiresAt: Date;
  respondedAt: Date | null;
  declineReason: string | null;
}

function toInvitationView(row: InvitationView): InvitationView {
  return {
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

  const expiresAt = new Date(
    Date.now() + (input.expiresInHours ?? DEFAULT_INVITATION_HOURS) * 60 * 60 * 1000,
  );

  return prisma.$transaction(async (tx: Tx) => {
    const created: InvitationView[] = [];

    for (const userId of input.userIds) {
      // Re-inviting somebody who already has a live invitation is a no-op
      // rather than an error: a facility clicking twice should not fail.
      const existing = await tx.invitation.findUnique({
        where: { serviceRequestId_userId: { serviceRequestId: request.id, userId } },
      });
      if (existing) {
        created.push(toInvitationView(existing));
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
        payload: { invitationId: invitation.id, userId, serviceRequestId: request.id },
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

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'INVITED' },
      data: {
        status: accepted ? 'ACCEPTED' : 'DECLINED',
        respondedAt: now,
        declineReason: accepted ? null : input.reason,
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
        },
      });
    }

    return toInvitationView(updated);
  });
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

export async function confirmAssignment(input: ConfirmParams): Promise<AssignmentView> {
  const request = await prisma.serviceRequest.findFirst({
    where: { id: input.requestId, facilityId: input.facilityId, deletedAt: null },
  });
  if (!request) throw AssignmentErrors.assignmentNotFound();

  return prisma.$transaction(async (tx: Tx) => {
    await lockPractitioner(tx, input.userId);

    // Everything below is read inside the lock, so what it sees cannot change
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

    // The last confirmation closes the request.
    if (confirmedCount + 1 >= request.headcount) {
      await tx.serviceRequest.updateMany({
        where: { id: request.id, status: 'PUBLISHED' },
        data: { status: 'FILLED' },
      });

      await recordAudit(tx, {
        action: 'service_request.filled',
        entityType: 'service_requests.service_requests',
        entityId: request.id,
        actorId: input.actorId,
        scopeType: 'FACILITY',
        scopeId: request.facilityId,
        after: { status: 'FILLED', confirmedCount: confirmedCount + 1 },
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

export async function cancelAssignment(
  input: CancelAssignmentParams,
): Promise<AssignmentView> {
  const existing = await prisma.assignment.findFirst({
    where: { id: input.assignmentId, facilityId: input.facilityId },
  });
  if (!existing) throw AssignmentErrors.assignmentNotFound();
  if (existing.status !== 'CONFIRMED') {
    throw AssignmentErrors.invalidTransition(existing.status, 'CANCELLED');
  }

  return prisma.$transaction(async (tx: Tx) => {
    const updated = await tx.assignment.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
    });

    await tx.assignmentStatusHistory.create({
      data: {
        assignmentId: updated.id,
        fromStatus: 'CONFIRMED',
        toStatus: 'CANCELLED',
        actorId: input.actorId,
        reason: input.reason,
      },
    });

    // Cancelling frees a place, so a filled request opens again.
    if (existing.serviceRequestId) {
      await tx.serviceRequest.updateMany({
        where: { id: existing.serviceRequestId, status: 'FILLED' },
        data: { status: 'PUBLISHED' },
      });
    }

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

    return toAssignmentView(updated);
  });
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
  const [completed, noShow] = await Promise.all([
    prisma.assignment.count({ where: { userId, status: 'COMPLETED' } }),
    prisma.assignment.count({ where: { userId, status: 'NO_SHOW' } }),
  ]);
  return { completed, noShow };
}

/** How many shifts this practitioner has actually completed. */
export async function countCompletedAssignments(userId: string): Promise<number> {
  return prisma.assignment.count({ where: { userId, status: 'COMPLETED' } });
}

export async function listInvitationsFor(userId: string): Promise<InvitationView[]> {
  const rows = await prisma.invitation.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toInvitationView);
}

export interface ListAssignmentsQuery {
  scopeType: 'SELF' | 'FACILITY';
  scopeId: string;
  status?: AssignmentStatusValue;
}

export async function listAssignments(
  query: ListAssignmentsQuery,
): Promise<AssignmentView[]> {
  const where: Prisma.AssignmentWhereInput =
    query.scopeType === 'SELF' ? { userId: query.scopeId } : { facilityId: query.scopeId };
  if (query.status) where.status = query.status;

  const rows = await prisma.assignment.findMany({ where, orderBy: { startsAt: 'asc' } });
  return rows.map(toAssignmentView);
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
