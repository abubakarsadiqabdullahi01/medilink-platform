import { prisma, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import {
  assertTransition,
  canTransition,
  type AttendanceState,
} from '../domain/state-machine';
import {
  checkInTokenExpiry,
  evaluateCheckInToken,
  generateCheckInCode,
  hashCheckInCode,
  parseQrPayload,
  qrPayload,
  type CheckInPurpose,
} from '../domain/check-in-token';
import { IllegalAttendanceTransition } from '../domain/state-machine';
import { getAssignment } from '@/modules/matching/application/assignment';
import { AttendanceErrors } from '../domain/errors';

/**
 * Attendance: what actually happened during the shift (steps 7.1–7.3).
 *
 * Every status change goes through `assertTransition`, so the state machine
 * is the only way a record moves and the gate condition — "attendance cannot
 * reach an illegal state through any code path" — holds by construction
 * rather than by review.
 */

export interface AttendanceView {
  id: string;
  assignmentId: string;
  status: AttendanceState;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  breakMinutes: number;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
}

interface AttendanceRow extends AttendanceView {
  createdAt: Date;
  updatedAt: Date;
}

function toView(row: AttendanceRow): AttendanceView {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    status: row.status,
    checkedInAt: row.checkedInAt,
    checkedOutAt: row.checkedOutAt,
    breakMinutes: row.breakMinutes,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    reviewNotes: row.reviewNotes,
  };
}

/** Translates the domain's refusal into an HTTP-shaped one. */
function guardTransition(from: AttendanceState, to: AttendanceState): void {
  try {
    assertTransition(from, to);
  } catch (error) {
    if (error instanceof IllegalAttendanceTransition) {
      throw AttendanceErrors.illegalTransition(from, to);
    }
    throw error;
  }
}

/**
 * Through matching's own application layer rather than by querying
 * `matching.assignments` — a module never reads another module's tables.
 */
async function loadAssignment(assignmentId: string) {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw AttendanceErrors.assignmentNotFound();
  return assignment;
}

/**
 * Every shift gets a record the first time anybody touches it, rather than
 * one being created when the assignment is confirmed. A confirmed assignment
 * nobody ever attends should still be findable as unhonoured (step 7.7), and
 * that is the sweep's job rather than a row's existence.
 */
export async function ensureAttendanceRecord(assignmentId: string): Promise<AttendanceView> {
  const assignment = await loadAssignment(assignmentId);
  if (assignment.status !== 'CONFIRMED') throw AttendanceErrors.assignmentNotConfirmed();

  const existing = await prisma.attendanceRecord.findUnique({ where: { assignmentId } });
  if (existing) return toView(existing);

  const created = await prisma.attendanceRecord.create({ data: { assignmentId } });
  return toView(created);
}

/**
 * Attendance for many shifts in one query — what a roster page needs for its
 * rows. A shift nobody has issued a code for has no record yet, so it is simply
 * absent from the map; callers read that as "not started".
 */
export async function attendanceForAssignments(
  assignmentIds: string[],
): Promise<Map<string, AttendanceView>> {
  if (assignmentIds.length === 0) return new Map();
  const rows = await prisma.attendanceRecord.findMany({
    where: { assignmentId: { in: assignmentIds } },
  });
  return new Map(rows.map((row) => [row.assignmentId, toView(row)]));
}

export async function getAttendance(assignmentId: string): Promise<AttendanceView> {
  const record = await prisma.attendanceRecord.findUnique({ where: { assignmentId } });
  if (!record) throw AttendanceErrors.recordNotFound();
  return toView(record);
}

export interface IssueTokenParams {
  assignmentId: string;
  purpose: CheckInPurpose;
  actorId: string;
}

export interface IssuedToken {
  /** The six digits a supervisor reads aloud. */
  code: string;
  /** The same secret, for a QR image. */
  qr: string;
  expiresAt: Date;
}

/**
 * The facility issues the token; the practitioner presents it. That direction
 * is what makes it evidence of presence — a code the practitioner could
 * generate themselves would prove only that they own a phone.
 *
 * The plaintext is returned once, here, and never stored.
 */
export async function issueCheckInToken(input: IssueTokenParams): Promise<IssuedToken> {
  const record = await ensureAttendanceRecord(input.assignmentId);

  const nextStatus: AttendanceState =
    input.purpose === 'CHECK_IN' ? 'CHECK_IN_PENDING' : record.status;

  if (input.purpose === 'CHECK_IN') {
    // Re-issuing while already pending is ordinary: a supervisor re-reads the
    // code because the practitioner mistyped it, or the first one lapsed. The
    // machine has no self-transitions, so only a real move is guarded.
    if (record.status !== nextStatus) guardTransition(record.status, nextStatus);
  } else if (record.status !== 'CHECKED_IN') {
    throw AttendanceErrors.notCheckedIn();
  }

  const code = generateCheckInCode();
  const now = new Date();
  const expiresAt = checkInTokenExpiry(now);

  await prisma.$transaction(async (tx: Tx) => {
    // Any token still outstanding for this purpose is superseded, so a stale
    // code read out earlier cannot be used after a new one is issued.
    await tx.checkInToken.updateMany({
      where: { attendanceRecordId: record.id, purpose: input.purpose, consumedAt: null },
      data: { consumedAt: now },
    });

    await tx.checkInToken.create({
      data: {
        attendanceRecordId: record.id,
        purpose: input.purpose,
        codeHash: hashCheckInCode(code, input.assignmentId, input.purpose, env.SESSION_SECRET),
        expiresAt,
        issuedBy: input.actorId,
      },
    });

    if (input.purpose === 'CHECK_IN' && record.status !== nextStatus) {
      await tx.attendanceRecord.update({
        where: { id: record.id },
        data: { status: nextStatus },
      });
    }

    await recordAudit(tx, {
      action: 'attendance.token_issued',
      entityType: 'attendance.checkin_tokens',
      entityId: record.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: (await loadAssignment(input.assignmentId)).facilityId,
      // The code itself is never audited — it is a live credential for the
      // next five minutes.
      after: { purpose: input.purpose, expiresAt },
    });
  });

  return { code, qr: qrPayload(input.assignmentId, input.purpose, code), expiresAt };
}

export interface PresentTokenParams {
  assignmentId: string;
  purpose: CheckInPurpose;
  /** Either the six digits, or a scanned QR payload. */
  code: string;
  userId: string;
  deviceLabel?: string;
  occurredAt?: Date;
}

/**
 * The practitioner presents the code, by typing it or by scanning. Both
 * arrive here, because they are the same secret.
 */
export async function presentCheckInToken(
  input: PresentTokenParams,
): Promise<AttendanceView> {
  const assignment = await loadAssignment(input.assignmentId);
  const record = await prisma.attendanceRecord.findUnique({
    where: { assignmentId: input.assignmentId },
  });
  if (!record) throw AttendanceErrors.recordNotFound();

  // A scanned payload carries its own assignment and purpose; a typed code
  // does not. Either way the digest is derived from all three, so a payload
  // naming another shift cannot match this record's token.
  const scanned = parseQrPayload(input.code);
  const code = scanned?.code ?? input.code.trim();
  const method = scanned ? 'QR' : 'SUPERVISOR_CODE';
  if (scanned && (scanned.assignmentId !== input.assignmentId || scanned.purpose !== input.purpose)) {
    throw AttendanceErrors.tokenInvalid('it was issued for another shift');
  }

  const now = input.occurredAt ?? new Date();
  const nextStatus: AttendanceState = input.purpose === 'CHECK_IN' ? 'CHECKED_IN' : 'CHECKED_OUT';
  guardTransition(record.status, nextStatus);

  if (input.purpose === 'CHECK_OUT' && record.checkedInAt && now <= record.checkedInAt) {
    throw AttendanceErrors.checkoutBeforeCheckIn();
  }

  const token = await prisma.checkInToken.findFirst({
    where: { attendanceRecordId: record.id, purpose: input.purpose },
    orderBy: { createdAt: 'desc' },
  });

  const verdict = evaluateCheckInToken(
    token,
    hashCheckInCode(code, input.assignmentId, input.purpose, env.SESSION_SECRET),
    now,
  );

  if (!verdict.ok) {
    // The attempt is counted before the caller learns the result, so
    // abandoning the request mid-flight does not buy a free guess — the same
    // reasoning consumeOtp already follows.
    if (token && verdict.reason === 'mismatch') {
      await prisma.checkInToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
    }
    throw AttendanceErrors.tokenInvalid(verdict.reason.replace(/_/g, ' '));
  }

  return prisma.$transaction(async (tx: Tx) => {
    await tx.checkInToken.updateMany({
      where: { id: token!.id, consumedAt: null },
      data: { consumedAt: now },
    });

    const updated = await tx.attendanceRecord.update({
      where: { id: record.id },
      data: {
        status: nextStatus,
        ...(input.purpose === 'CHECK_IN' ? { checkedInAt: now } : { checkedOutAt: now }),
      },
    });

    await tx.checkInEvent.create({
      data: {
        attendanceRecordId: record.id,
        kind: input.purpose,
        method,
        actorId: input.userId,
        occurredAt: now,
        deviceLabel: input.deviceLabel,
      },
    });

    await recordAudit(tx, {
      action: input.purpose === 'CHECK_IN' ? 'attendance.checked_in' : 'attendance.checked_out',
      entityType: 'attendance.attendance_records',
      entityId: record.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: assignment.userId,
      before: toView(record),
      after: toView(updated),
    });

    await publishEvent(tx, {
      eventType: input.purpose === 'CHECK_IN' ? EVENTS.ShiftStarted : EVENTS.ShiftCompleted,
      aggregateType: 'attendance.attendance_records',
      aggregateId: record.id,
      payload: {
        assignmentId: input.assignmentId,
        userId: assignment.userId,
        facilityId: assignment.facilityId,
        occurredAt: now.toISOString(),
      },
    });

    return toView(updated);
  });
}

export interface ManualRecordParams {
  assignmentId: string;
  actorId: string;
  checkedInAt: Date;
  checkedOutAt: Date;
  breakMinutes?: number;
  /** Mandatory. Step 7.3 exists so a dispute can read why. */
  reason: string;
}

/**
 * Step 7.3 — the fallback for a facility whose network failed.
 *
 * Recorded afterwards by a supervisor, with a mandatory reason, and marked
 * `MANUALLY_CORRECTED` so nobody later mistakes it for a token-backed
 * check-in. Both events are written, so the log still says what happened and
 * when it was recorded — `occurredAt` and `recordedAt` are different columns
 * for exactly this case.
 */
export async function recordManualAttendance(
  input: ManualRecordParams,
): Promise<AttendanceView> {
  if (!input.reason?.trim()) throw AttendanceErrors.manualReasonRequired();
  if (input.checkedOutAt.getTime() <= input.checkedInAt.getTime()) {
    throw AttendanceErrors.checkoutBeforeCheckIn();
  }

  const assignment = await loadAssignment(input.assignmentId);
  const record = await ensureAttendanceRecord(input.assignmentId);
  const existing = await prisma.attendanceRecord.findUniqueOrThrow({
    where: { assignmentId: input.assignmentId },
  });

  guardTransition(record.status, 'MANUALLY_CORRECTED');
  const now = new Date();

  return prisma.$transaction(async (tx: Tx) => {
    const updated = await tx.attendanceRecord.update({
      where: { id: record.id },
      data: {
        status: 'MANUALLY_CORRECTED',
        checkedInAt: input.checkedInAt,
        checkedOutAt: input.checkedOutAt,
        breakMinutes: input.breakMinutes ?? existing.breakMinutes,
      },
    });

    for (const [kind, occurredAt] of [
      ['CHECK_IN', input.checkedInAt],
      ['CHECK_OUT', input.checkedOutAt],
    ] as const) {
      await tx.checkInEvent.create({
        data: {
          attendanceRecordId: record.id,
          kind,
          method: 'MANUAL',
          actorId: input.actorId,
          occurredAt,
          recordedAt: now,
          reason: input.reason,
        },
      });
    }

    await recordAudit(tx, {
      action: 'attendance.recorded_manually',
      entityType: 'attendance.attendance_records',
      entityId: record.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: assignment.facilityId,
      reason: input.reason,
      before: toView(existing),
      after: toView(updated),
    });

    // The same event a code check-out publishes. A shift recorded from the
    // ward register was still worked and still ends here, and everything
    // downstream of completion — the timesheet it is costed into, most of all
    // — had been reaching only the shifts that happened to have a working
    // network at the end of them.
    await publishEvent(tx, {
      eventType: EVENTS.ShiftCompleted,
      aggregateType: 'attendance.attendance_records',
      aggregateId: record.id,
      payload: {
        assignmentId: input.assignmentId,
        userId: assignment.userId,
        facilityId: assignment.facilityId,
      },
    });

    return toView(updated);
  });
}

export async function listCheckInEvents(assignmentId: string) {
  const record = await prisma.attendanceRecord.findUnique({ where: { assignmentId } });
  if (!record) throw AttendanceErrors.recordNotFound();

  return prisma.checkInEvent.findMany({
    where: { attendanceRecordId: record.id },
    orderBy: { recordedAt: 'asc' },
    select: {
      kind: true,
      method: true,
      actorId: true,
      occurredAt: true,
      recordedAt: true,
      reason: true,
      deviceLabel: true,
    },
  });
}

export { canTransition };

/**
 * Which of these assignments show any sign of the shift having happened.
 *
 * Exposed as a function rather than as a table to join: the unhonoured sweep
 * in `cancellations-sanctions` needs to know whether attendance ever started,
 * and a module never reads another module's tables.
 *
 * "Any sign" is deliberately generous — a record still at NOT_STARTED means
 * nobody touched it, but anything else, including a check-in that was only
 * ever pending, means somebody was there doing something. A sweep that
 * accused on a narrower test would be accusing on a network failure.
 */
export async function assignmentsWithAttendance(assignmentIds: string[]): Promise<Set<string>> {
  if (assignmentIds.length === 0) return new Set();

  const rows = await prisma.attendanceRecord.findMany({
    where: { assignmentId: { in: assignmentIds }, status: { not: 'NOT_STARTED' } },
    select: { assignmentId: true },
  });
  return new Set(rows.map((row) => row.assignmentId));
}

/**
 * Module 14 opens a case; this is what that does to the shift.
 *
 * Only `APPROVED` and `REJECTED` can be disputed — the machine says so — and
 * the state the record was in is remembered here rather than in the dispute,
 * because putting it back is attendance's invariant and not the case file's.
 */
export async function openDispute(input: {
  assignmentId: string;
  actorId: string;
  reason: string;
}): Promise<AttendanceView> {
  const record = await prisma.attendanceRecord.findUnique({
    where: { assignmentId: input.assignmentId },
  });
  if (!record) throw AttendanceErrors.recordNotFound();

  const assignment = await loadAssignment(input.assignmentId);
  const from = record.status as AttendanceState;
  guardTransition(from, 'DISPUTED');

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.attendanceRecord.updateMany({
      where: { id: record.id, status: from },
      data: { status: 'DISPUTED', preDisputeStatus: from },
    });
    if (applied.count !== 1) throw AttendanceErrors.illegalTransition(from, 'DISPUTED');

    const updated = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } });

    await recordAudit(tx, {
      action: 'attendance.disputed',
      entityType: 'attendance.attendance_records',
      entityId: record.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: assignment.facilityId,
      reason: input.reason,
      before: { status: from },
      after: { status: updated.status, preDisputeStatus: updated.preDisputeStatus },
    });

    return toView(updated);
  });
}

/**
 * And this is what resolving one does.
 *
 * Upheld sends the figures back to be decided again, because a complaint that
 * was right means the record is wrong and somebody has to say what it should
 * be. Dismissed puts it back exactly where it was — which is only possible
 * because `preDisputeStatus` was written when the case opened.
 */
export async function closeDispute(input: {
  assignmentId: string;
  actorId: string;
  outcome: 'UPHELD' | 'DISMISSED';
  reason: string;
}): Promise<AttendanceView> {
  const record = await prisma.attendanceRecord.findUnique({
    where: { assignmentId: input.assignmentId },
  });
  if (!record) throw AttendanceErrors.recordNotFound();

  const assignment = await loadAssignment(input.assignmentId);
  const from = record.status as AttendanceState;
  // A record that is not disputed has no dispute to close, and saying so here
  // is clearer than letting the transition table refuse it obliquely.
  if (from !== 'DISPUTED') throw AttendanceErrors.illegalTransition(from, 'SUBMITTED');

  // Falling back to SUBMITTED rather than throwing: a dispute opened before
  // this column existed has nothing to restore, and sending it to be decided
  // again is the safe reading of an unknown previous state.
  const restored = (record.preDisputeStatus as AttendanceState | null) ?? 'SUBMITTED';
  const to: AttendanceState = input.outcome === 'UPHELD' ? 'SUBMITTED' : restored;
  guardTransition(from, to);

  return prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.attendanceRecord.updateMany({
      where: { id: record.id, status: 'DISPUTED' },
      data: { status: to, preDisputeStatus: null },
    });
    if (applied.count !== 1) throw AttendanceErrors.illegalTransition(from, to);

    const updated = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: record.id } });

    await recordAudit(tx, {
      action: input.outcome === 'UPHELD' ? 'attendance.dispute_upheld' : 'attendance.dispute_dismissed',
      entityType: 'attendance.attendance_records',
      entityId: record.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: assignment.facilityId,
      reason: input.reason,
      before: { status: from, preDisputeStatus: record.preDisputeStatus },
      after: { status: updated.status },
    });

    return toView(updated);
  });
}
