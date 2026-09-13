import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { getAssignment } from '@/modules/matching/application/assignment';
import { excusalDecisionBlockers, type ExcusalStatusValue } from '../domain/fault';
import { FaultErrors } from './fault';

/**
 * Step 7.8: a practitioner asks to be excused, an officer grants or refuses,
 * and **both outcomes are retained**.
 *
 * Retained means exactly that: a refusal is a row that stays, and a later
 * request is a second row rather than an overwrite of the first. A table that
 * only remembered the answer somebody liked would make the history useless
 * for the dispute it exists to serve.
 */

export interface ExcusalView {
  id: string;
  assignmentId: string;
  requestedBy: string;
  reason: string;
  status: ExcusalStatusValue;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNotes: string | null;
  createdAt: Date;
}

function toView(row: {
  id: string;
  assignmentId: string;
  requestedBy: string;
  reason: string;
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNotes: string | null;
  createdAt: Date;
}): ExcusalView {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    requestedBy: row.requestedBy,
    reason: row.reason,
    status: row.status as ExcusalStatusValue,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNotes: row.decisionNotes,
    createdAt: row.createdAt,
  };
}

export interface RequestExcusalParams {
  assignmentId: string;
  userId: string;
  reason: string;
}

/**
 * The practitioner's own act, so it is SELF-scoped and the assignment must be
 * theirs. Requesting is always allowed: whether the reason is any good is the
 * officer's judgement, not a validation rule.
 */
export async function requestExcusal(input: RequestExcusalParams): Promise<ExcusalView> {
  const assignment = await getAssignment(input.assignmentId);
  if (!assignment || assignment.userId !== input.userId) throw FaultErrors.notFound();

  return prisma.$transaction(async (tx: Tx) => {
    const created = await tx.excusal.create({
      data: {
        assignmentId: input.assignmentId,
        requestedBy: input.userId,
        reason: input.reason,
      },
    });

    await recordAudit(tx, {
      action: 'excusal.requested',
      entityType: 'cancellations_sanctions.excusals',
      entityId: created.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      reason: input.reason,
      after: { assignmentId: input.assignmentId, status: created.status },
    });

    return toView(created);
  });
}

export interface DecideExcusalParams {
  excusalId: string;
  actorId: string;
  decision: 'grant' | 'refuse';
  /** Mandatory on a refusal, for the reason a rejected timesheet's is. */
  notes?: string;
}

/**
 * Granting closes any open fault determination as NEITHER.
 *
 * That is what "a granted excusal carries no penalty" means in the data: the
 * assignment never reaches NO_SHOW, so it never enters the no-show term of
 * the reliability ratio, so the score is unchanged. Granting is itself a
 * person's decision, so the gate condition — no unhonoured assignment closes
 * without one — is satisfied rather than bypassed.
 *
 * Refusing decides nothing about fault. The officer still has to make that
 * finding separately, and an excusal refused for being unpersuasive is not
 * the same as an absence proven to be the practitioner's fault.
 */
export async function decideExcusal(input: DecideExcusalParams): Promise<ExcusalView> {
  const row = await prisma.excusal.findUnique({ where: { id: input.excusalId } });
  if (!row) throw FaultErrors.excusalNotFound();

  const blockers = excusalDecisionBlockers({
    status: row.status as ExcusalStatusValue,
    decision: input.decision,
    notes: input.notes ?? '',
  });
  if (blockers.length > 0) throw FaultErrors.cannotDecideExcusal(blockers);

  const assignment = await getAssignment(row.assignmentId);
  if (!assignment) throw FaultErrors.notFound();

  const granted = input.decision === 'grant';
  const now = new Date();

  const decided = await prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.excusal.updateMany({
      where: { id: row.id, status: 'REQUESTED' },
      data: {
        status: granted ? 'GRANTED' : 'REFUSED',
        decidedBy: input.actorId,
        decidedAt: now,
        decisionNotes: input.notes,
      },
    });
    if (applied.count !== 1) throw FaultErrors.cannotDecideExcusal(['already_decided']);

    const updated = await tx.excusal.findUniqueOrThrow({ where: { id: row.id } });

    await recordAudit(tx, {
      action: granted ? 'excusal.granted' : 'excusal.refused',
      entityType: 'cancellations_sanctions.excusals',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: assignment.userId,
      reason: input.notes,
      before: { status: row.status },
      after: { status: updated.status },
    });

    return updated;
  });

  if (granted) {
    // Imported here rather than at the top: `fault.ts` needs this module's
    // granted-excusal check, and a static import both ways is a cycle.
    const { recordFault, getDetermination } = await import('./fault');
    const open = await prisma.unhonouredAssignment.findUnique({
      where: { assignmentId: row.assignmentId },
    });

    if (open && open.status === 'AWAITING_DECISION') {
      await recordFault({
        assignmentId: row.assignmentId,
        actorId: input.actorId,
        fault: 'NEITHER',
        reason: `Excusal granted: ${input.notes?.trim() || row.reason}`,
      });
      await getDetermination(row.assignmentId);
    }
  }

  return toView(decided);
}

/**
 * Every request on this assignment, oldest first — refusals included. That is
 * the retention rule made readable.
 */
export async function listExcusals(assignmentId: string): Promise<ExcusalView[]> {
  const rows = await prisma.excusal.findMany({
    where: { assignmentId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toView);
}
