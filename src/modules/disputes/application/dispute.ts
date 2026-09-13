import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { HttpError } from '@/lib/http/errors';
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
 * **Nothing here publishes an event on resolution, and that is deliberate.**
 * Upholding sends the figures back to `SUBMITTED`, so the ordinary approval
 * path publishes `TimesheetApproved` again when they are decided; dismissing
 * restores the record unchanged, so downstream has nothing to react to. An
 * event announcing a resolution would carry no information the existing ones
 * do not, and Section 8.2's vocabulary is not mine to extend for that.
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

/** Every case over this shift, oldest first — withdrawn and dismissed included. */
export async function listDisputesFor(assignmentId: string): Promise<DisputeView[]> {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw DisputeErrors.assignmentNotFound();

  const rows = await prisma.dispute.findMany({
    where: { assignmentId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => toView(row, assignment.userId, assignment.facilityId));
}

/** The adjudicator's queue: everything live, oldest first. */
export async function listLiveDisputes(): Promise<DisputeView[]> {
  const rows = await prisma.dispute.findMany({
    where: { status: { in: LIVE } },
    orderBy: { createdAt: 'asc' },
  });

  const views: DisputeView[] = [];
  for (const row of rows) {
    const assignment = await getAssignment(row.assignmentId);
    if (!assignment) continue;
    views.push(toView(row, assignment.userId, assignment.facilityId));
  }
  return views;
}
