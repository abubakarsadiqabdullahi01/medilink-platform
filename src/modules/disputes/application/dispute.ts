import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
import { isAuthorized, loadGrants } from '@/lib/authz/guard';
import { getAssignment } from '@/modules/matching/application/assignment';
import {
  closeDispute,
  getAttendance,
  openDispute,
} from '@/modules/attendance/application/attendance';
import {
  openBlockers,
  partyFor,
  resolveBlockers,
  withdrawBlockers,
  type DisputeCategoryValue,
  type DisputeOutcomeValue,
  type DisputePartyValue,
  type DisputeStatusValue,
} from '../domain/dispute';

/**
 * Module 14: a case opened over a shift that has already been decided.
 *
 * The case is this module's; the shift's state is attendance's, reached
 * through `openDispute` and `closeDispute` rather than by writing
 * `attendance.attendance_records` from here. That split is the whole reason
 * the attendance record remembers its own pre-dispute state instead of this
 * table doing it.
 *
 * **Everybody concerned is told what happens to a case.** Opening, being
 * picked up, being decided and being withdrawn each publish an event in the
 * same transaction as the change, and the notification handlers turn them into
 * texts. The admin screen has long said that marking a case under review "tells
 * the other side somebody is looking" and that both sides read the outcome; with
 * only DisputeOpened published and nothing consuming it, neither was true.
 *
 * Resolution publishes the *outcome* and never the officer's notes: a text
 * message is not where a finding belongs, and the parties read the reasons in
 * the app. Upholding still sends the figures back to `SUBMITTED`, so the
 * ordinary approval path publishes `TimesheetApproved` again when they are
 * decided; that is a separate fact and this event does not stand in for it.
 */

export const DisputeErrors = {
  notFound: () => new HttpError('dispute_not_found', 'That dispute does not exist.', 404),

  assignmentNotFound: () =>
    new HttpError('assignment_not_found', 'That assignment does not exist.', 404),

  cannotOpen: (blockers: string[]) =>
    new HttpError('dispute_cannot_open', `This dispute cannot be opened: ${blockers.join(', ')}.`, 409),

  cannotResolve: (blockers: string[]) =>
    new HttpError(
      'dispute_cannot_resolve',
      `This dispute cannot be resolved: ${blockers.join(', ')}.`,
      409,
    ),

  cannotWithdraw: (blockers: string[]) =>
    new HttpError(
      'dispute_cannot_withdraw',
      `This dispute cannot be withdrawn: ${blockers.join(', ')}.`,
      409,
    ),
};

export interface DisputeView {
  id: string;
  assignmentId: string;
  userId: string;
  facilityId: string;
  raisedBy: string;
  raisedParty: DisputePartyValue;
  category: DisputeCategoryValue;
  reason: string;
  status: DisputeStatusValue;
  outcome: DisputeOutcomeValue | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  withdrawnAt: Date | null;
  createdAt: Date;
}

interface DisputeRow {
  id: string;
  assignmentId: string;
  raisedBy: string;
  raisedParty: string;
  category: string;
  reason: string;
  status: string;
  outcome: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNotes: string | null;
  withdrawnAt: Date | null;
  createdAt: Date;
}

function toView(row: DisputeRow, userId: string, facilityId: string): DisputeView {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    userId,
    facilityId,
    raisedBy: row.raisedBy,
    raisedParty: row.raisedParty as DisputePartyValue,
    category: row.category as DisputeCategoryValue,
    reason: row.reason,
    status: row.status as DisputeStatusValue,
    outcome: row.outcome as DisputeOutcomeValue | null,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt,
    resolutionNotes: row.resolutionNotes,
    withdrawnAt: row.withdrawnAt,
    createdAt: row.createdAt,
  };
}

async function loadCase(disputeId: string) {
  const row = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!row) throw DisputeErrors.notFound();

  const assignment = await getAssignment(row.assignmentId);
  if (!assignment) throw DisputeErrors.assignmentNotFound();

  return { row, assignment };
}

export type CaseSide = 'PRACTITIONER' | 'FACILITY' | 'ADJUDICATOR';

/**
 * Where somebody stands on one case, or `null` if they stand nowhere.
 *
 * `dispute.manage` is held by practitioners (at SELF), facility owners and
 * approvers (at FACILITY) and officers (at PLATFORM), so on its own it says
 * nothing about *this* case — the route guard proves the permission and the
 * scope the caller named, not that the case is in it. Everything that reads a
 * case or what is attached to it asks here, and a `null` is answered as "not
 * found" so the id is not confirmed to exist.
 *
 * The practitioner side is the assignee by identity, the facility side is a
 * grant over *this* shift's facility, and the adjudicator side is a PLATFORM
 * grant. Order matters: a PLATFORM grant satisfies every scope, so it is
 * recognised before the facility check and not mistaken for one.
 */
export async function sideOnCase(
  viewerId: string,
  assignment: { userId: string; facilityId: string },
): Promise<CaseSide | null> {
  if (viewerId === assignment.userId) return 'PRACTITIONER';

  const grants = await loadGrants(viewerId);
  if (isAuthorized(grants, 'dispute.manage', { type: 'PLATFORM' })) return 'ADJUDICATOR';
  if (isAuthorized(grants, 'dispute.manage', { type: 'FACILITY', id: assignment.facilityId })) {
    return 'FACILITY';
  }
  return null;
}

/** What every dispute event carries: enough to find the people, nothing of the argument. */
function eventPayload(
  row: { id: string; assignmentId: string; raisedParty: string },
  assignment: { userId: string; facilityId: string },
) {
  return {
    disputeId: row.id,
    assignmentId: row.assignmentId,
    userId: assignment.userId,
    facilityId: assignment.facilityId,
    raisedParty: row.raisedParty,
  };
}

/** Open, or being worked. Both are live cases as far as every rule here goes. */
const LIVE: DisputeStatusValue[] = ['OPEN', 'UNDER_REVIEW'];

export interface RaiseDisputeParams {
  assignmentId: string;
  actorId: string;
  /**
   * Set when the caller is acting for a facility, from the scope they were
   * authorised against. The guard proves they act for *that* facility; this
   * is checked against the shift so it also proves the shift is theirs.
   */
  facilityId?: string;
  category: DisputeCategoryValue;
  reason: string;
}

/**
 * Either party may raise a case; nobody else may.
 *
 * An operations officer adjudicates disputes, and deliberately cannot open
 * one — a case nobody involved wanted is not a dispute, it is an audit.
 */
export async function raiseDispute(input: RaiseDisputeParams): Promise<DisputeView> {
  const assignment = await getAssignment(input.assignmentId);
  if (!assignment) throw DisputeErrors.assignmentNotFound();

  const facilityMember =
    input.facilityId !== undefined && input.facilityId === assignment.facilityId;
  const party = partyFor({
    actorId: input.actorId,
    practitionerId: assignment.userId,
    facilityMember,
  });

  // Before anything about the shift is said. Somebody on neither side used to be
  // told "cannot be opened: not_a_party, not_yet_decided, …" - a 409 that
  // confirmed the shift exists and listed what state its attendance was in. The
  // evidence routes already answer an outsider as if the id did not exist; this
  // is the same rule for the door in front of them (AUT-10). An adjudicator is an
  // outsider here too: they weigh a case, they do not open one, and can read it.
  if (party === null) throw DisputeErrors.assignmentNotFound();

  const attendance = await getAttendance(input.assignmentId);
  const live = await prisma.dispute.count({
    where: { assignmentId: input.assignmentId, status: { in: LIVE } },
  });

  const blockers = openBlockers({
    attendanceStatus: attendance.status,
    decidedAt: attendance.reviewedAt,
    hasOpenDispute: live > 0,
    reason: input.reason,
    isParty: party !== null,
    now: new Date(),
  });
  if (blockers.length > 0) throw DisputeErrors.cannotOpen(blockers);

  const created = await prisma.$transaction(async (tx: Tx) => {
    // Re-counted inside the transaction. The check above is what produces a
    // readable list of blockers; this is what makes "one open case" true when
    // both parties click at the same moment.
    const stillNone = await tx.dispute.count({
      where: { assignmentId: input.assignmentId, status: { in: LIVE } },
    });
    if (stillNone > 0) throw DisputeErrors.cannotOpen(['already_open']);

    const row = await tx.dispute.create({
      data: {
        assignmentId: input.assignmentId,
        raisedBy: input.actorId,
        raisedParty: party as DisputePartyValue,
        category: input.category,
        reason: input.reason,
      },
    });

    await recordAudit(tx, {
      action: 'dispute.opened',
      entityType: 'disputes.disputes',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: assignment.facilityId,
      reason: input.reason,
      after: { status: row.status, category: row.category, raisedParty: row.raisedParty },
    });

    await publishEvent(tx, {
      eventType: EVENTS.DisputeOpened,
      aggregateType: 'disputes.disputes',
      aggregateId: row.id,
      payload: {
        disputeId: row.id,
        assignmentId: input.assignmentId,
        userId: assignment.userId,
        facilityId: assignment.facilityId,
        raisedParty: row.raisedParty,
        category: row.category,
      },
    });

    return row;
  });

  // Attendance's write, through attendance's own application layer and
  // outside the transaction above — the same shape as approval reaching
  // matching, and the reason the record ends up DISPUTED rather than this
  // module setting a status it does not own.
  await openDispute({
    assignmentId: input.assignmentId,
    actorId: input.actorId,
    reason: input.reason,
  });

  return toView(created, assignment.userId, assignment.facilityId);
}

/**
 * Marks a case as being worked. Nothing turns on it beyond making the queue
 * honest: two officers opening the same case is wasted effort, not a
 * correctness problem, so this is a claim rather than a lock.
 */
export async function beginReview(input: {
  disputeId: string;
  actorId: string;
}): Promise<DisputeView> {
  const { row, assignment } = await loadCase(input.disputeId);
  if (row.status !== 'OPEN') throw DisputeErrors.cannotResolve(['not_open']);

  const updated = await prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.dispute.updateMany({
      where: { id: row.id, status: 'OPEN' },
      data: { status: 'UNDER_REVIEW' },
    });
    if (applied.count !== 1) throw DisputeErrors.cannotResolve(['not_open']);

    const next = await tx.dispute.findUniqueOrThrow({ where: { id: row.id } });

    await recordAudit(tx, {
      action: 'dispute.review_started',
      entityType: 'disputes.disputes',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: assignment.facilityId,
      before: { status: row.status },
      after: { status: next.status },
    });

    await publishEvent(tx, {
      eventType: EVENTS.DisputeUnderReview,
      aggregateType: 'disputes.disputes',
      aggregateId: row.id,
      payload: eventPayload(next, assignment),
    });

    return next;
  });

  return toView(updated, assignment.userId, assignment.facilityId);
}

export interface ResolveDisputeParams {
  disputeId: string;
  actorId: string;
  /** Required. "Resolved" with no outcome tells the loser nothing. */
  outcome: DisputeOutcomeValue | null;
  notes: string;
}

/**
 * Upheld sends the figures back to be decided again; dismissed puts the
 * record back exactly where it was.
 *
 * Upholding does not itself say what the right figures are, and should not:
 * an adjudicator decides who was right, and the facility then corrects the
 * timesheet through the ordinary route with its own revision and reason. A
 * resolution that silently rewrote the hours would be a correction nobody
 * could see in `timesheet_revisions`.
 */
export async function resolveDispute(input: ResolveDisputeParams): Promise<DisputeView> {
  const { row, assignment } = await loadCase(input.disputeId);

  const blockers = resolveBlockers({
    status: row.status as DisputeStatusValue,
    outcome: input.outcome,
    notes: input.notes ?? '',
  });
  if (blockers.length > 0) throw DisputeErrors.cannotResolve(blockers);

  const outcome = input.outcome as DisputeOutcomeValue;
  const now = new Date();

  const updated = await prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.dispute.updateMany({
      where: { id: row.id, status: { in: LIVE } },
      data: {
        status: 'RESOLVED',
        outcome,
        resolvedBy: input.actorId,
        resolvedAt: now,
        resolutionNotes: input.notes,
      },
    });
    if (applied.count !== 1) throw DisputeErrors.cannotResolve(['not_open']);

    const next = await tx.dispute.findUniqueOrThrow({ where: { id: row.id } });

    await recordAudit(tx, {
      action: outcome === 'UPHELD' ? 'dispute.upheld' : 'dispute.dismissed',
      entityType: 'disputes.disputes',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: assignment.facilityId,
      reason: input.notes,
      before: { status: row.status, outcome: row.outcome },
      after: { status: next.status, outcome: next.outcome },
    });

    await publishEvent(tx, {
      eventType: EVENTS.DisputeResolved,
      aggregateType: 'disputes.disputes',
      aggregateId: row.id,
      payload: { ...eventPayload(next, assignment), outcome },
    });

    return next;
  });

  await closeDispute({
    assignmentId: row.assignmentId,
    actorId: input.actorId,
    outcome,
    reason: input.notes,
  });

  return toView(updated, assignment.userId, assignment.facilityId);
}

/**
 * The party who raised it can take it back, and the shift returns to where it
 * was — the same restore a dismissal does, because a withdrawn complaint and
 * a rejected one leave the record in the same place.
 *
 * The row stays, with its reason and its withdrawal time. A case that
 * vanished when somebody thought better of it would take the other party's
 * side of the story with it.
 */
export async function withdrawDispute(input: {
  disputeId: string;
  actorId: string;
}): Promise<DisputeView> {
  const { row, assignment } = await loadCase(input.disputeId);

  // Somebody with no part in the case gets "not found", not a refusal that confirms
  // it exists. Only then is the question whether they are the one who raised it.
  if ((await sideOnCase(input.actorId, assignment)) === null) throw DisputeErrors.notFound();

  const blockers = withdrawBlockers({
    status: row.status as DisputeStatusValue,
    raisedBy: row.raisedBy,
    actorId: input.actorId,
  });
  if (blockers.length > 0) throw DisputeErrors.cannotWithdraw(blockers);

  const now = new Date();
  const updated = await prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.dispute.updateMany({
      where: { id: row.id, status: { in: LIVE } },
      data: { status: 'WITHDRAWN', withdrawnAt: now },
    });
    if (applied.count !== 1) throw DisputeErrors.cannotWithdraw(['not_open']);

    const next = await tx.dispute.findUniqueOrThrow({ where: { id: row.id } });

    await recordAudit(tx, {
      action: 'dispute.withdrawn',
      entityType: 'disputes.disputes',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: assignment.userId,
      before: { status: row.status },
      after: { status: next.status },
    });

    await publishEvent(tx, {
      eventType: EVENTS.DisputeWithdrawn,
      aggregateType: 'disputes.disputes',
      aggregateId: row.id,
      payload: eventPayload(next, assignment),
    });

    return next;
  });

  await closeDispute({
    assignmentId: row.assignmentId,
    actorId: input.actorId,
    outcome: 'DISMISSED',
    reason: 'Dispute withdrawn by the party that raised it.',
  });

  return toView(updated, assignment.userId, assignment.facilityId);
}

export async function getDispute(disputeId: string): Promise<DisputeView> {
  const { row, assignment } = await loadCase(disputeId);
  return toView(row, assignment.userId, assignment.facilityId);
}

/**
 * Which of these shifts have a case open or being worked on them.
 *
 * For billing, which holds back what was credited for a shift in dispute and
 * may not read this module's tables. A resolved or withdrawn case is not
 * live: the hold lifts the moment the case ends.
 */
export async function assignmentsUnderDispute(assignmentIds: string[]): Promise<Set<string>> {
  if (assignmentIds.length === 0) return new Set();
  const rows = await prisma.dispute.findMany({
    where: { assignmentId: { in: assignmentIds }, status: { in: LIVE } },
    select: { assignmentId: true },
  });
  return new Set(rows.map((row) => row.assignmentId));
}

/**
 * Every case over this shift, oldest first — withdrawn and dismissed included.
 *
 * Only for the two sides of the shift and the adjudicator. The route's scope
 * is whatever the caller declared, so a practitioner naming their own SELF
 * scope with somebody else's assignment id passed the guard and was handed
 * that person's complaint.
 */
export async function listDisputesFor(
  assignmentId: string,
  viewerId: string,
): Promise<DisputeView[]> {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw DisputeErrors.assignmentNotFound();
  if ((await sideOnCase(viewerId, assignment)) === null) throw DisputeErrors.assignmentNotFound();

  const rows = await prisma.dispute.findMany({
    where: { assignmentId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => toView(row, assignment.userId, assignment.facilityId));
}

/** The adjudicator's queue: everything live, oldest first. */
export interface DisputeQueueRow extends DisputeView {
  practitionerName: string;
  facilityName: string;
  shiftStartsAt: Date;
}

/**
 * The adjudicator's queue, with the shift and the people on it named.
 *
 * The screen was showing a fragment of a uuid where a practitioner's name and
 * a shift's date belong — the same gap `listUnhonoured` closed for step 7.7,
 * for the same reason: deciding who was right about a shift is not a decision
 * anybody should be asked to make against `76a16e95`. One joined query rather
 * than `getAssignment` per row, which was fine at six live disputes and would
 * not have stayed fine at sixty.
 */
export interface DisputeQueuePage {
  disputes: DisputeQueueRow[];
  nextCursor: string | null;
}

/**
 * The adjudicator's queue, named, searchable and paged — and reaching every
 * status, not only the live ones.
 *
 * It used to be `listLiveDisputes`, hard-wired to `status: {in: LIVE}` with
 * no limit and no way to look a case up by name. That meant a dispute
 * resolved last month was unreachable from this screen the moment it left
 * the live set — the same gap step 7.7's queue had before `listUnhonoured`
 * closed it, for the same reason: "what did we decide about that one" needs
 * an answer that survives the case leaving the open queue.
 */
export async function listDisputes(
  filter: {
    status?: DisputeStatusValue;
    search?: string;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<DisputeQueuePage> {
  const limit = filter.limit ?? 50;
  const where: Prisma.DisputeWhereInput = {
    status: filter.status ?? { in: LIVE },
  };

  if (filter.search) {
    const search = filter.search.trim();
    where.assignment = {
      OR: [
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { serviceRequest: { facility: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    };
  }

  const rows = await prisma.dispute.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    include: {
      assignment: {
        select: {
          userId: true,
          facilityId: true,
          startsAt: true,
          user: { select: { fullName: true } },
          serviceRequest: { select: { facility: { select: { name: true } } } },
        },
      },
    },
  });

  const page = rows.slice(0, limit);
  const disputes = page.map((row) => ({
    ...toView(row, row.assignment.userId, row.assignment.facilityId),
    practitionerName: row.assignment.user.fullName,
    facilityName: row.assignment.serviceRequest.facility.name,
    shiftStartsAt: row.assignment.startsAt,
  }));

  return {
    disputes,
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}


/** A case as the facility it is over sees it in a list. */
export interface FacilityDisputeRow extends DisputeView {
  practitionerName: string;
  shiftStartsAt: Date;
  /** Whether it was the facility's side that raised it. */
  raisedByFacility: boolean;
}

/**
 * Every case over this facility's own shifts, newest first, every status: a case
 * decided last month is still something the facility answers for.
 *
 * The facility is the shift's, not the caller's word: the filter is the
 * assignment's own facility. The route has already proved the caller holds
 * `dispute.manage` over it.
 */
export async function listDisputesForFacility(
  facilityId: string,
  status?: DisputeStatusValue,
): Promise<FacilityDisputeRow[]> {
  const rows = await prisma.dispute.findMany({
    where: { assignment: { facilityId }, ...(status ? { status } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    include: {
      assignment: {
        select: { userId: true, facilityId: true, startsAt: true, user: { select: { fullName: true } } },
      },
    },
  });

  return rows.map((row) => ({
    ...toView(row, row.assignment.userId, row.assignment.facilityId),
    practitionerName: row.assignment.user.fullName,
    shiftStartsAt: row.assignment.startsAt,
    raisedByFacility: row.raisedParty === 'FACILITY',
  }));
}

/**
 * One case, for somebody who is a party to it or the adjudicator, and for nobody
 * else: a stranger gets "not found", the answer an id that does not exist would
 * get. Also says which side the viewer is on.
 */
export async function getCaseForParty(
  disputeId: string,
  viewerId: string,
): Promise<{ dispute: DisputeView; side: CaseSide }> {
  const { row, assignment } = await loadCase(disputeId);
  const side = await sideOnCase(viewerId, assignment);
  if (side === null) throw DisputeErrors.notFound();
  return { dispute: toView(row, assignment.userId, assignment.facilityId), side };
}
