import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import {
  getAssignment,
  markAssignmentCompleted,
} from '@/modules/matching/application/assignment';
import { getServiceRequest } from '@/modules/service-requests/application/request';
import { AttendanceErrors } from '@/modules/attendance/domain/errors';
import {
  assertTransition,
  IllegalAttendanceTransition,
  type AttendanceState,
} from '@/modules/attendance/domain/state-machine';
import { computeTimesheet, watDateOf, TimesheetError } from '../domain/hours';

/**
 * Steps 7.4, 7.5 and 7.6: the hours a shift comes to, who approved them, and
 * what they were before somebody corrected them.
 *
 * The assignment and the service request are reached through their own
 * modules' application layers rather than by querying their tables — the rule
 * in docs/module-map.md.
 */

export interface TimesheetView {
  id: string;
  assignmentId: string;
  attendanceStatus: AttendanceState;
  workedMinutes: number;
  breakMinutes: number;
  billableMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  holidayMinutes: number;
  onCallMinutes: number;
  hourlyRateKobo: number;
  amountKobo: number;
  currency: string;
  revision: number;
}

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

/** Every WAT calendar date the shift touches, so the holiday lookup is one query. */
async function holidayDatesFor(from: Date, to: Date): Promise<Set<string>> {
  const dates = new Set<string>();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let at = from.getTime() - dayMs; at <= to.getTime() + dayMs; at += dayMs) {
    dates.add(watDateOf(new Date(at)));
  }

  const rows = await prisma.publicHoliday.findMany({
    where: { date: { gte: new Date(from.getTime() - dayMs), lte: new Date(to.getTime() + dayMs) } },
    select: { date: true },
  });

  // `date` is a DATE column, so it comes back as midnight UTC; the WAT
  // calendar day it names is the date as written, not as shifted.
  return new Set(rows.map((row) => row.date.toISOString().slice(0, 10)));
}

async function loadContext(assignmentId: string) {
  const record = await prisma.attendanceRecord.findUnique({ where: { assignmentId } });
  if (!record) throw AttendanceErrors.recordNotFound();

  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw AttendanceErrors.assignmentNotFound();

  return { record, assignment };
}

/**
 * Computes the timesheet from whatever attendance currently says, creating it
 * or replacing its figures.
 *
 * Recomputed rather than edited: the hours are a function of the check-in,
 * the check-out and the break, so the only way they and the attendance record
 * can disagree is if somebody edited one of them by hand.
 */
export async function computeAndSaveTimesheet(assignmentId: string): Promise<TimesheetView> {
  const { record, assignment } = await loadContext(assignmentId);

  if (!record.checkedInAt || !record.checkedOutAt) {
    throw AttendanceErrors.notCheckedIn();
  }

  const request = await getServiceRequest({
    requestId: assignment.serviceRequestId,
    facilityId: assignment.facilityId,
  });

  const holidayDates = await holidayDatesFor(record.checkedInAt, record.checkedOutAt);

  const existing = await prisma.timesheet.findUnique({
    where: { attendanceRecordId: record.id },
  });

  // On-call is the one figure no clock produces: it is hours held available,
  // which only a person can assert. It is read back from the row rather than
  // recomputed, so a recomputation does not silently drop what a correction
  // put there.
  let totals;
  try {
    totals = computeTimesheet({
      checkedInAt: record.checkedInAt,
      checkedOutAt: record.checkedOutAt,
      breakMinutes: record.breakMinutes,
      scheduledStartsAt: assignment.startsAt,
      scheduledEndsAt: assignment.endsAt,
      hourlyRateKobo: request.hourlyRateKobo,
      holidayDates,
      onCallMinutes: existing?.onCallMinutes ?? 0,
    });
  } catch (error) {
    // The domain refuses impossible shifts; those are 422s, not crashes.
    if (error instanceof TimesheetError) {
      throw AttendanceErrors.illegalTransition(record.status, record.status);
    }
    throw error;
  }

  const data = {
    workedMinutes: totals.workedMinutes,
    breakMinutes: totals.breakMinutes,
    billableMinutes: totals.billableMinutes,
    nightMinutes: totals.nightMinutes,
    nightOnlyMinutes: totals.exclusive.nightMinutes,
    overtimeMinutes: totals.overtimeMinutes,
    holidayMinutes: totals.holidayMinutes,
    onCallMinutes: totals.onCallMinutes,
    hourlyRateKobo: request.hourlyRateKobo,
    amountKobo: totals.amountKobo,
  };

  // One statement, not a read and then a write. Two callers reach this for the
  // same shift — the ShiftCompleted handler when it is checked out, and
  // submitTimesheet when the practitioner presses Submit — and a check-out
  // followed at once by Submit raced the two between the read above and the
  // create, so one of them failed on the unique attendance_record_id and the
  // practitioner saw a 500. Prisma runs this as a native ON CONFLICT upsert.
  const saved = await prisma.timesheet.upsert({
    where: { attendanceRecordId: record.id },
    update: data,
    create: { attendanceRecordId: record.id, ...data },
  });

  return { ...saved, assignmentId, attendanceStatus: record.status };
}

export async function getTimesheet(assignmentId: string): Promise<TimesheetView> {
  const { record } = await loadContext(assignmentId);
  const timesheet = await prisma.timesheet.findUnique({
    where: { attendanceRecordId: record.id },
  });
  if (!timesheet) throw AttendanceErrors.noTimesheet();
  return { ...timesheet, assignmentId, attendanceStatus: record.status };
}

export interface SubmitParams {
  assignmentId: string;
  userId: string;
}

/**
 * Step 7.5. The practitioner submits what the shift came to; the facility
 * approves or rejects it.
 */
export async function submitTimesheet(input: SubmitParams): Promise<TimesheetView> {
  const { record, assignment } = await loadContext(input.assignmentId);

  // Whose shift this is, asked before anything is written. The route can only
  // authorise the caller against their own SELF scope, which it always
  // satisfies; nothing there could tell that the assignment in the path
  // belonged to somebody else, so without this a practitioner could submit
  // another practitioner's hours under their own name. 404 rather than 403,
  // the same way an assignment belonging to another facility is reported.
  if (assignment.userId !== input.userId) throw AttendanceErrors.assignmentNotFound();

  guardTransition(record.status, 'SUBMITTED');

  // Recomputed at submission, so what is being submitted is what attendance
  // currently says rather than a figure computed earlier and left behind.
  await computeAndSaveTimesheet(input.assignmentId);
  const now = new Date();

  return prisma.$transaction(async (tx: Tx) => {
    const updated = await tx.attendanceRecord.update({
      where: { id: record.id },
      data: { status: 'SUBMITTED', submittedAt: now, submittedBy: input.userId },
    });

    const timesheet = await tx.timesheet.findUniqueOrThrow({
      where: { attendanceRecordId: record.id },
    });

    await recordAudit(tx, {
      action: 'timesheet.submitted',
      entityType: 'timesheets.timesheets',
      entityId: timesheet.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: assignment.userId,
      after: { billableMinutes: timesheet.billableMinutes, amountKobo: timesheet.amountKobo },
    });

    await publishEvent(tx, {
      eventType: EVENTS.TimesheetSubmitted,
      aggregateType: 'timesheets.timesheets',
      aggregateId: timesheet.id,
      payload: {
        assignmentId: input.assignmentId,
        userId: assignment.userId,
        facilityId: assignment.facilityId,
      },
    });

    return { ...timesheet, assignmentId: input.assignmentId, attendanceStatus: updated.status };
  });
}

export interface ReviewParams {
  assignmentId: string;
  facilityId: string;
  actorId: string;
  decision: 'approve' | 'reject';
  reviewNotes?: string;
}

/**
 * Approval is what finally sets the assignment to `COMPLETED` — a state that
 * has been in the enum since Stage 6 with nothing reaching it, and the thing
 * that ends cold start for the reliability score.
 */
export async function reviewTimesheet(input: ReviewParams): Promise<TimesheetView> {
  const { record, assignment } = await loadContext(input.assignmentId);
  if (assignment.facilityId !== input.facilityId) throw AttendanceErrors.assignmentNotFound();

  const approved = input.decision === 'approve';
  // A rejection nobody can act on is worse than no rejection: the
  // practitioner has to know what to correct.
  if (!approved && !input.reviewNotes?.trim()) throw AttendanceErrors.reviewNotesRequired();

  guardTransition(record.status, approved ? 'APPROVED' : 'REJECTED');
  const now = new Date();

  const result = await prisma.$transaction(async (tx: Tx) => {
    const applied = await tx.attendanceRecord.updateMany({
      where: { id: record.id, status: 'SUBMITTED' },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        reviewedAt: now,
        reviewedBy: input.actorId,
        reviewNotes: input.reviewNotes,
      },
    });
    if (applied.count !== 1) throw AttendanceErrors.illegalTransition(record.status, 'APPROVED');

    const timesheet = await tx.timesheet.findUniqueOrThrow({
      where: { attendanceRecordId: record.id },
    });

    await recordAudit(tx, {
      action: approved ? 'timesheet.approved' : 'timesheet.rejected',
      entityType: 'timesheets.timesheets',
      entityId: timesheet.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: assignment.userId,
      reason: input.reviewNotes,
      after: { status: approved ? 'APPROVED' : 'REJECTED', amountKobo: timesheet.amountKobo },
    });

    if (approved) {
      await publishEvent(tx, {
        eventType: EVENTS.TimesheetApproved,
        aggregateType: 'timesheets.timesheets',
        aggregateId: timesheet.id,
        payload: {
          assignmentId: input.assignmentId,
          userId: assignment.userId,
          facilityId: assignment.facilityId,
          amountKobo: timesheet.amountKobo,
        },
      });
    }

    return {
      ...timesheet,
      assignmentId: input.assignmentId,
      attendanceStatus: (approved ? 'APPROVED' : 'REJECTED') as AttendanceState,
    };
  });

  // Outside the transaction above because it is the matching module's write,
  // through its own application layer.
  if (approved) {
    await markAssignmentCompleted({
      assignmentId: input.assignmentId,
      actorId: input.actorId,
      reason: 'Timesheet approved',
    });
  }

  return result;
}

export interface CorrectParams {
  assignmentId: string;
  /** Checked against the assignment: the scope guard proves the caller acts
   * for this facility, not that this shift belongs to it. */
  facilityId: string;
  actorId: string;
  checkedInAt?: Date;
  checkedOutAt?: Date;
  breakMinutes?: number;
  onCallMinutes?: number;
  /** Mandatory. A correction nobody explained is one nobody can adjudicate. */
  reason: string;
}

/**
 * Step 7.6 — "no correction destroys the value it replaces".
 *
 * The previous state is written whole into a revision before anything is
 * changed: not a diff, because a diff can only be read against a history
 * nobody kept. The actor and the reason go with it, and the timesheet's
 * revision number goes up. The original row is still there, linked.
 */
export async function correctTimesheet(input: CorrectParams): Promise<TimesheetView> {
  if (!input.reason?.trim()) throw AttendanceErrors.correctionReasonRequired();

  const { record, assignment } = await loadContext(input.assignmentId);
  if (assignment.facilityId !== input.facilityId) throw AttendanceErrors.assignmentNotFound();

  // Correcting a record that is already corrected is ordinary: a supervisor
  // fixes the break, then notices the check-out was wrong too. The machine has
  // no self-transitions, so only a real move is guarded — the same distinction
  // re-issuing a check-in code makes. Staying put loses nothing, because each
  // correction writes its own revision either way.
  if (record.status !== 'MANUALLY_CORRECTED') {
    guardTransition(record.status, 'MANUALLY_CORRECTED');
  }

  const existing = await prisma.timesheet.findUnique({
    where: { attendanceRecordId: record.id },
  });
  if (!existing) throw AttendanceErrors.noTimesheet();

  const checkedInAt = input.checkedInAt ?? record.checkedInAt;
  const checkedOutAt = input.checkedOutAt ?? record.checkedOutAt;
  if (!checkedInAt || !checkedOutAt) throw AttendanceErrors.notCheckedIn();
  if (checkedOutAt.getTime() <= checkedInAt.getTime()) {
    throw AttendanceErrors.checkoutBeforeCheckIn();
  }

  await prisma.$transaction(async (tx: Tx) => {
    // The whole previous state, before anything moves.
    await tx.timesheetRevision.create({
      data: {
        timesheetId: existing.id,
        revision: existing.revision,
        previous: {
          workedMinutes: existing.workedMinutes,
          breakMinutes: existing.breakMinutes,
          billableMinutes: existing.billableMinutes,
          nightMinutes: existing.nightMinutes,
          nightOnlyMinutes: existing.nightOnlyMinutes,
          overtimeMinutes: existing.overtimeMinutes,
          holidayMinutes: existing.holidayMinutes,
          onCallMinutes: existing.onCallMinutes,
          hourlyRateKobo: existing.hourlyRateKobo,
          amountKobo: existing.amountKobo,
          checkedInAt: record.checkedInAt?.toISOString() ?? null,
          checkedOutAt: record.checkedOutAt?.toISOString() ?? null,
        } as Prisma.InputJsonValue,
        actorId: input.actorId,
        reason: input.reason,
      },
    });

    await tx.attendanceRecord.update({
      where: { id: record.id },
      data: {
        status: 'MANUALLY_CORRECTED',
        checkedInAt,
        checkedOutAt,
        breakMinutes: input.breakMinutes ?? record.breakMinutes,
      },
    });

    await tx.timesheet.update({
      where: { id: existing.id },
      data: { revision: { increment: 1 }, onCallMinutes: input.onCallMinutes ?? existing.onCallMinutes },
    });

    await recordAudit(tx, {
      action: 'timesheet.corrected',
      entityType: 'timesheets.timesheets',
      entityId: existing.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: assignment.userId,
      reason: input.reason,
      before: { revision: existing.revision, amountKobo: existing.amountKobo },
    });
  });

  return computeAndSaveTimesheet(input.assignmentId);
}

export interface RevisionView {
  revision: number;
  previous: unknown;
  actorId: string;
  reason: string;
  createdAt: Date;
}

/**
 * The timesheet and its revisions for many shifts in three queries, however
 * many shifts: the attendance records, the timesheets on them, and the
 * revisions of those. What a timesheet list needs for every row, where it used
 * to ask for each shift separately — a page of fifty was fifty-one requests
 * and a practitioner's whole history could be two hundred.
 *
 * A shift with no timesheet yet (not worked, or not yet checked out) is simply
 * absent from the map.
 */
export async function timesheetsForAssignments(
  assignmentIds: string[],
): Promise<Map<string, { timesheet: TimesheetView; revisions: RevisionView[] }>> {
  const out = new Map<string, { timesheet: TimesheetView; revisions: RevisionView[] }>();
  if (assignmentIds.length === 0) return out;

  const records = await prisma.attendanceRecord.findMany({
    where: { assignmentId: { in: assignmentIds } },
    select: { id: true, assignmentId: true, status: true },
  });
  if (records.length === 0) return out;

  const timesheets = await prisma.timesheet.findMany({
    where: { attendanceRecordId: { in: records.map((row) => row.id) } },
  });
  const revisions = timesheets.length
    ? await prisma.timesheetRevision.findMany({
        where: { timesheetId: { in: timesheets.map((row) => row.id) } },
        orderBy: { revision: 'asc' },
      })
    : [];

  const recordOf = new Map(records.map((row) => [row.id, row]));
  for (const timesheet of timesheets) {
    const record = recordOf.get(timesheet.attendanceRecordId);
    if (!record) continue;
    out.set(record.assignmentId, {
      timesheet: {
        ...timesheet,
        assignmentId: record.assignmentId,
        attendanceStatus: record.status,
      },
      revisions: revisions
        .filter((row) => row.timesheetId === timesheet.id)
        .map((row) => ({
          revision: row.revision,
          previous: row.previous,
          actorId: row.actorId,
          reason: row.reason,
          createdAt: row.createdAt,
        })),
    });
  }
  return out;
}

export async function timesheetRevisions(assignmentId: string): Promise<RevisionView[]> {
  const { record } = await loadContext(assignmentId);
  const timesheet = await prisma.timesheet.findUnique({
    where: { attendanceRecordId: record.id },
  });
  if (!timesheet) return [];

  const rows = await prisma.timesheetRevision.findMany({
    where: { timesheetId: timesheet.id },
    orderBy: { revision: 'asc' },
  });

  return rows.map((row) => ({
    revision: row.revision,
    previous: row.previous,
    actorId: row.actorId,
    reason: row.reason,
    createdAt: row.createdAt,
  }));
}
