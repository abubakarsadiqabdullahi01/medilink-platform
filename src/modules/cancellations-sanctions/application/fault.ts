import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import {
  getAssignment,
  listEndedConfirmedAssignments,
  settleUnhonouredAssignment,
} from '@/modules/matching/application/assignment';
import { assignmentsWithAttendance } from '@/modules/attendance/application/attendance';
import {
  assignmentOutcomeFor,
  closeBlockers,
  type CloseBlocker,
  type FaultValue,
  type UnhonouredStatusValue,
} from '../domain/fault';

/**
 * Steps 7.7 and 7.8: an assignment nobody honoured, and who was answerable
 * for it.
 *
 * A sweep flags; a person decides. Nothing here closes itself, because an
 * absence has a dozen innocent explanations and the platform cannot tell them
 * apart from a database row. The assignment is reached through matching's own
 * application layer, per the rule in docs/module-map.md.
 */

export const FaultErrors = {
  notFound: () =>
    new HttpError('unhonoured_not_found', 'No unhonoured assignment record was found.', 404),

  excusalNotFound: () => new HttpError('excusal_not_found', 'No such excusal request.', 404),

  // The blockers are in the message rather than a details object, because
  // HttpError carries a code and a message and nothing else — and a caller
  // told only "cannot close" has to guess which rule it broke.
  cannotClose: (blockers: CloseBlocker[]) =>
    new HttpError(
      'unhonoured_cannot_close',
      `This determination cannot be closed: ${blockers.join(', ')}.`,
      409,
    ),

  cannotDecideExcusal: (blockers: string[]) =>
    new HttpError(
      'excusal_cannot_decide',
      `This excusal request cannot be decided: ${blockers.join(', ')}.`,
      409,
    ),
};

export interface UnhonouredView {
  id: string;
  assignmentId: string;
  userId: string;
  facilityId: string;
  status: UnhonouredStatusValue;
  fault: FaultValue | null;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  shiftEndedAt: Date;
  detectedAt: Date;
}

function toView(
  row: {
    id: string;
    assignmentId: string;
    status: string;
    fault: string | null;
    reason: string | null;
    decidedBy: string | null;
    decidedAt: Date | null;
    shiftEndedAt: Date;
    detectedAt: Date;
  },
  userId: string,
  facilityId: string,
): UnhonouredView {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    userId,
    facilityId,
    status: row.status as UnhonouredStatusValue,
    fault: row.fault as FaultValue | null,
    reason: row.reason,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    shiftEndedAt: row.shiftEndedAt,
    detectedAt: row.detectedAt,
  };
}

async function loadDetermination(assignmentId: string) {
  const row = await prisma.unhonouredAssignment.findUnique({ where: { assignmentId } });
  if (!row) throw FaultErrors.notFound();

  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw FaultErrors.notFound();

  return { row, assignment };
}

/**
 * Step 7.7's sweep. Finds assignments whose shift has ended with nothing to
 * show for it and flags them **awaiting a decision** — it does not decide.
 *
 * Idempotent, because `claimDueJobs` guarantees nothing about how many times
 * a sweep runs: the unique index on `assignment_id` and the skip below mean a
 * second pass over the same shift writes nothing.
 */
export async function sweepUnhonouredAssignments(now: Date = new Date()): Promise<number> {
  const ended = await listEndedConfirmedAssignments(now);
  if (ended.length === 0) return 0;

  const attended = await assignmentsWithAttendance(ended.map((assignment) => assignment.id));
  const unhonoured = ended.filter((assignment) => !attended.has(assignment.id));
  if (unhonoured.length === 0) return 0;

  const alreadyFlagged = await prisma.unhonouredAssignment.findMany({
    where: { assignmentId: { in: unhonoured.map((assignment) => assignment.id) } },
    select: { assignmentId: true },
  });
  const known = new Set(alreadyFlagged.map((row) => row.assignmentId));

  let flagged = 0;
  for (const assignment of unhonoured) {
    if (known.has(assignment.id)) continue;

    await prisma.$transaction(async (tx: Tx) => {
      const created = await tx.unhonouredAssignment.create({
        data: { assignmentId: assignment.id, shiftEndedAt: assignment.endsAt },
      });

      await recordAudit(tx, {
        action: 'assignment.unhonoured_flagged',
        entityType: 'cancellations_sanctions.unhonoured_assignments',
        entityId: created.id,
        // No actorId. The sweep is not a person, and a name against a
        // finding nobody made would be worse than a blank.
        scopeType: 'FACILITY',
        scopeId: assignment.facilityId,
        after: { assignmentId: assignment.id, status: created.status },
      });
    });
    flagged += 1;
  }

  return flagged;
}

export interface RecordFaultParams {
  assignmentId: string;
  actorId: string;
  /** Required. Null is not a decision, and the close is refused without it. */
  fault: FaultValue | null;
  reason: string;
}

/**
 * Step 7.7's gate condition: an unhonoured assignment cannot reach a final
 * state without a fault value.
 *
 * The refusal is here rather than only in the schema, so it holds for the
 * sweep, a script and a route alike.
 */
export async function recordFault(input: RecordFaultParams): Promise<UnhonouredView> {
  const { row, assignment } = await loadDetermination(input.assignmentId);

  const granted = await prisma.excusal.count({
    where: { assignmentId: input.assignmentId, status: 'GRANTED' },
  });

  const blockers = closeBlockers({
    status: row.status as UnhonouredStatusValue,
    fault: input.fault,
    reason: input.reason ?? '',
    hasGrantedExcusal: granted > 0,
  });
  if (blockers.length > 0) throw FaultErrors.cannotClose(blockers);

  // Non-null past the blockers: `fault_not_decided` is one of them.
  const fault = input.fault as FaultValue;

  const closed = await prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.unhonouredAssignment.updateMany({
      where: { id: row.id, status: 'AWAITING_DECISION' },
      data: {
        status: 'CLOSED',
        fault,
        decidedBy: input.actorId,
        decidedAt: new Date(),
        reason: input.reason,
      },
    });
    if (applied.count !== 1) throw FaultErrors.cannotClose(['already_closed']);

    const updated = await tx.unhonouredAssignment.findUniqueOrThrow({ where: { id: row.id } });

    await recordAudit(tx, {
      action: 'assignment.fault_recorded',
      entityType: 'cancellations_sanctions.unhonoured_assignments',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: assignment.facilityId,
      reason: input.reason,
      before: { status: row.status, fault: row.fault },
      after: { status: updated.status, fault: updated.fault },
    });

    return updated;
  });

  // Matching's write, through matching's own application layer and outside
  // the transaction above.
  await settleUnhonouredAssignment({
    assignmentId: input.assignmentId,
    outcome: assignmentOutcomeFor(fault),
    actorId: input.actorId,
    reason: input.reason,
  });

  return toView(closed, assignment.userId, assignment.facilityId);
}

/** Everything still awaiting a decision. The queue a person works through. */
export async function listAwaitingFault(): Promise<UnhonouredView[]> {
  const rows = await prisma.unhonouredAssignment.findMany({
    where: { status: 'AWAITING_DECISION' },
    orderBy: { detectedAt: 'asc' },
  });

  const views: UnhonouredView[] = [];
  for (const row of rows) {
    const assignment = await getAssignment(row.assignmentId);
    if (!assignment) continue;
    views.push(toView(row, assignment.userId, assignment.facilityId));
  }
  return views;
}

/**
 * The queue a person works through, filtered and paged.
 *
 * `listAwaitingFault` is kept for its callers, but it answers only one
 * question — what is still awaiting a decision — and answers it by fetching
 * every row and then calling `getAssignment` once per row. Fine at six flags;
 * a query per row and no way to look at a decided one at sixty.
 *
 * The names are joined here because the screen was showing `76a16e95` where a
 * nurse's name belongs. Deciding that somebody failed to turn up, against a
 * fragment of a uuid, is not a decision anybody should be asked to make: the
 * practitioner comes off the assignment, the facility off the request behind
 * it, and both arrive in the same query rather than N more.
 */
export interface UnhonouredQueueRow extends UnhonouredView {
  practitionerName: string;
  practitionerPhone: string;
  facilityName: string;
  shiftStartsAt: Date;
}

export interface UnhonouredQueuePage {
  unhonoured: UnhonouredQueueRow[];
  nextCursor: string | null;
}

export interface ListUnhonouredQuery {
  status?: UnhonouredStatusValue;
  /** Matches the practitioner's name or the facility's. */
  search?: string;
  limit: number;
  cursor?: string;
}

export async function listUnhonoured(query: ListUnhonouredQuery): Promise<UnhonouredQueuePage> {
  const where: Prisma.UnhonouredAssignmentWhereInput = {
    status: query.status ?? 'AWAITING_DECISION',
  };

  if (query.search) {
    const search = query.search.trim();
    where.assignment = {
      OR: [
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { serviceRequest: { facility: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    };
  }

  const rows = await prisma.unhonouredAssignment.findMany({
    where,
    // Oldest first: an undecided flag is unfinished business, and the one that
    // has waited longest is the one somebody is still owed an answer about.
    orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: {
      assignment: {
        select: {
          userId: true,
          facilityId: true,
          startsAt: true,
          user: { select: { fullName: true, phone: true } },
          serviceRequest: { select: { facility: { select: { name: true } } } },
        },
      },
    },
  });

  const page = rows.slice(0, query.limit);

  const unhonoured = page.map((row) => ({
    ...toView(row, row.assignment.userId, row.assignment.facilityId),
    practitionerName: row.assignment.user.fullName,
    practitionerPhone: row.assignment.user.phone,
    facilityName: row.assignment.serviceRequest.facility.name,
    shiftStartsAt: row.assignment.startsAt,
  }));

  return {
    unhonoured,
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getDetermination(assignmentId: string): Promise<UnhonouredView> {
  const { row, assignment } = await loadDetermination(assignmentId);
  return toView(row, assignment.userId, assignment.facilityId);
}
