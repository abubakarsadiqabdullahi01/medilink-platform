import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { randomUUID } from 'node:crypto';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import {
  bookingTermsFor,
  getAssignment,
  markAssignmentCompleted,
} from '@/modules/matching/application/assignment';
import { termsOfBooking } from '@/modules/rates-contracts/application/rate-card';
import { priceStoredTimesheet } from '@/modules/rates-contracts/domain/pricing';
import { getServiceRequest } from '@/modules/service-requests/application/request';
import { AttendanceErrors } from '@/modules/attendance/domain/errors';
import { isInFuture } from '@/modules/attendance/domain/recorded-times';
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
 * States in which the figures are under review or decided. Only a person's act moves
 * them from here: a correction goes through the machine, a recalculation is refused
 * with a revision on the way (see `requireFiguresStillHold`), and a late event does nothing.
 */
const LOCKED_STATES: readonly AttendanceState[] = ['SUBMITTED', 'APPROVED', 'DISPUTED'];

/** What a timesheet row keeps of a worked shift, and so what two workings are compared on. */
const FIGURE_KEYS = [
  'workedMinutes',
  'breakMinutes',
  'billableMinutes',
  'nightMinutes',
  'nightOnlyMinutes',
  'overtimeMinutes',
  'holidayMinutes',
  'onCallMinutes',
  'hourlyRateKobo',
  'amountKobo',
] as const;

type Figures = Record<(typeof FIGURE_KEYS)[number], number>;

type Context = Awaited<ReturnType<typeof loadContext>>;

/**
 * What the shift comes to on the data as it stands now: the check-in and check-out and
 * the break on the attendance record, the rate on the request, the holiday calendar.
 * Computed, not saved.
 */
async function currentFigures({ record, assignment }: Context): Promise<{
  figures: Figures;
  existing: Awaited<ReturnType<typeof prisma.timesheet.findUnique>>;
}> {
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

  return {
    existing,
    figures: {
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
    },
  };
}

/**
 * Computes the timesheet from whatever attendance currently says, creating it
 * or replacing its figures.
 *
 * Recomputed rather than edited: the hours are a function of the check-in,
 * the check-out and the break, so the only way they and the attendance record
 * can disagree is if somebody edited one of them by hand.
 *
 * Not once the sheet has been submitted. From then it is being reviewed or has been
 * decided, and the ShiftCompleted event that calls this is delivered at least once, so
 * it can arrive again, days later, to a calendar that has changed. It would rewrite a
 * submitted or an approved sheet from today's data with no revision and no audit row.
 * The stored figures are returned as they are.
 */
export async function computeAndSaveTimesheet(assignmentId: string): Promise<TimesheetView> {
  const context = await loadContext(assignmentId);
  const { record } = context;

  if (LOCKED_STATES.includes(record.status)) {
    const kept = await prisma.timesheet.findUnique({ where: { attendanceRecordId: record.id } });
    if (kept) return { ...kept, assignmentId, attendanceStatus: record.status };
  }

  const { figures: data } = await currentFigures(context);

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

/**
 * The whole previous state of a sheet, as a revision keeps it: not a diff, because a
 * diff can only be read against a history nobody kept.
 */
function snapshotOf(
  existing: Figures,
  record: { checkedInAt: Date | null; checkedOutAt: Date | null },
): Prisma.InputJsonValue {
  const figures = Object.fromEntries(FIGURE_KEYS.map((key) => [key, existing[key]]));
  return {
    ...figures,
    checkedInAt: record.checkedInAt?.toISOString() ?? null,
    checkedOutAt: record.checkedOutAt?.toISOString() ?? null,
  } as Prisma.InputJsonValue;
}

/**
 * M10-04: approval is of the figures the approver saw, worked out on the data as it
 * stands now. The holiday calendar moves on its own (a holiday is declared, or a
 * mistaken one removed, after a shift was worked), so a sheet priced before that and
 * approved after it would pay a practitioner without a holiday that was declared, or bill
 * a facility for one that was not.
 *
 * When the working differs, the sheet takes the new figures, keeping the old ones as a
 * revision with who asked and why, and the approval is refused: the next one is of what
 * is now on the screen. A screen says which revision it showed, and an approval of any
 * other is refused the same way, so a screen that did not reload cannot approve what
 * it never displayed.
 */
async function requireFiguresStillHold(
  context: Context,
  actorId: string,
  seenRevision?: number,
): Promise<void> {
  const { record, assignment } = context;
  const { figures, existing } = await currentFigures(context);
  if (!existing) throw AttendanceErrors.noTimesheet();

  // Somebody approving from a screen that was drawn before the figures were last worked out
  // again (or corrected) is approving what they did not see, whatever the figures are now.
  if (seenRevision !== undefined && seenRevision !== existing.revision) {
    throw AttendanceErrors.figuresChanged();
  }

  if (FIGURE_KEYS.every((key) => existing[key] === figures[key])) return;

  await prisma.$transaction(async (tx: Tx) => {
    await tx.timesheetRevision.create({
      data: {
        timesheetId: existing.id,
        revision: existing.revision,
        previous: snapshotOf(existing, record),
        actorId,
        reason:
          'Recalculated before approval: the holiday calendar or the rate changed after the hours were submitted.',
      },
    });

    await tx.timesheet.update({
      where: { id: existing.id },
      data: { ...figures, revision: { increment: 1 } },
    });

    await recordAudit(tx, {
      action: 'timesheet.recalculated',
      entityType: 'timesheets.timesheets',
      entityId: existing.id,
      actorId,
      scopeType: 'SELF',
      scopeId: assignment.userId,
      reason: 'Figures differed from the data as it stands at approval.',
      before: { revision: existing.revision, amountKobo: existing.amountKobo },
      after: { revision: existing.revision + 1, amountKobo: figures.amountKobo },
    });
  });

  throw AttendanceErrors.figuresChanged();
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
        timesheetId: timesheet.id,
        // One per submission, so a sheet sent back and submitted again tells
        // the facility again instead of being taken for a repeat delivery.
        submissionKey: randomUUID(),
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
  /**
   * The revision of the sheet the approver was looking at. Optional so a caller that never
   * showed a sheet is not refused; a screen always sends it, so an approval is of what was seen.
   */
  seenRevision?: number;
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
  if (approved) {
    await requireFiguresStillHold({ record, assignment }, input.actorId, input.seenRevision);
  }
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

    if (!approved) {
      await publishEvent(tx, {
        eventType: EVENTS.TimesheetRejected,
        aggregateType: 'timesheets.timesheets',
        aggregateId: timesheet.id,
        payload: {
          assignmentId: input.assignmentId,
          userId: assignment.userId,
          facilityId: assignment.facilityId,
        },
      });
    }

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
  // A correction names times that have happened (ATT-04). Only the ones it supplies are
  // asked: the times already on the record were written when they were.
  if (
    (input.checkedInAt && isInFuture(input.checkedInAt)) ||
    (input.checkedOutAt && isInFuture(input.checkedOutAt))
  ) {
    throw AttendanceErrors.timeInFuture();
  }

  await prisma.$transaction(async (tx: Tx) => {
    // The whole previous state, before anything moves.
    await tx.timesheetRevision.create({
      data: {
        timesheetId: existing.id,
        revision: existing.revision,
        previous: snapshotOf(existing, record),
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

/**
 * What the facility will be billed for the shift, which is not `amountKobo`.
 *
 * `amountKobo` is the hours at the base rate. The premiums on the facility's own
 * card - night, holiday, overtime - are added when the invoice is raised, so the
 * screen that asks a facility to approve a timesheet showed ₦40,000 for a shift
 * that was then invoiced at ₦60,000. Priced here by the same function the
 * invoice uses, on the terms fixed when the shift was booked.
 */
export interface BilledFigures {
  billedKobo: number;
  premiumKobo: number;
}

export type TimesheetWithBilling = TimesheetView & BilledFigures;

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
): Promise<Map<string, { timesheet: TimesheetWithBilling; revisions: RevisionView[] }>> {
  const out = new Map<string, { timesheet: TimesheetWithBilling; revisions: RevisionView[] }>();
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
  const bookings = await bookingTermsFor(records.map((row) => row.assignmentId));
  for (const timesheet of timesheets) {
    const record = recordOf.get(timesheet.attendanceRecordId);
    if (!record) continue;

    // Without its booking there is nothing to price on, so the base figure is
    // all that is known and no premium is claimed.
    const booking = bookings.get(record.assignmentId);
    const priced = booking
      ? priceStoredTimesheet(timesheet, await termsOfBooking(booking)).priced
      : null;

    out.set(record.assignmentId, {
      timesheet: {
        ...timesheet,
        assignmentId: record.assignmentId,
        attendanceStatus: record.status,
        billedKobo: priced?.totalKobo ?? timesheet.amountKobo,
        premiumKobo: priced?.premiumKobo ?? 0,
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
