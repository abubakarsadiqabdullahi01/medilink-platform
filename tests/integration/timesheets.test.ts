import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import {
  createServiceRequest,
  publishServiceRequest,
} from '@/modules/service-requests/application/request';
import {
  assignmentOutcomes,
  confirmAssignment,
  getAssignment,
  getAssignmentInScope,
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { reliabilityFrom } from '@/modules/matching/domain/reliability';
import { recordManualAttendance } from '@/modules/attendance/application/attendance';
import {
  computeAndSaveTimesheet,
  correctTimesheet,
  getTimesheet,
  reviewTimesheet,
  submitTimesheet,
  timesheetRevisions,
} from '@/modules/timesheets/application/timesheet';
import { ROUTES } from '@/modules/timesheets/routes';
import { POST as reviewRoute } from '@/app/api/v1/assignments/[id]/timesheet/review/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import {
  createFacilityType,
  createProfessionalCategory,
  createState,
  createUser,
  ensureRole,
  grant,
} from './support/fixtures';

/**
 * Steps 7.4, 7.5 and 7.6 — the hours a shift came to, who decided about
 * them, and what they were before somebody changed them.
 *
 * The band arithmetic is unit-tested in `domain/hours.test.ts` against a
 * table of known shifts. What is asserted here is the part a pure function
 * cannot cover: that the figures come from the request both parties agreed,
 * that a rejection without a reason is refused, that a correction leaves the
 * original readable, and that approval is what finally moves an assignment
 * to COMPLETED.
 */

/** The rate on the request: 5,000 naira an hour, in kobo. */
const HOURLY_RATE_KOBO = 500_000;

/**
 * A fixed past Wednesday, 08:00-16:00 WAT. Fixed rather than relative to now
 * so the bands do not depend on what time the suite happens to run: no part
 * of this shift falls in the 20:00-06:00 night window, and it is neither a
 * weekend nor a holiday.
 */
const WORKED_FROM = new Date('2026-09-09T07:00:00.000Z');
const WORKED_TO = new Date('2026-09-09T15:00:00.000Z');

/** The shift as scheduled: also eight hours, so nothing is overtime. */
const SHIFT_START = new Date(Date.now() + 2 * 60 * 60 * 1000);
const SHIFT_END = new Date(SHIFT_START.getTime() + 8 * 60 * 60 * 1000);

let sequence = 0;

interface World {
  facilityId: string;
  schedulerId: string;
  reviewerId: string;
  practitionerId: string;
  assignmentId: string;
}

/** A confirmed assignment with the shift already recorded as worked. */
async function buildWorld(): Promise<World> {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const officer = await createUser({ fullName: 'Compliance Officer' });

  sequence += 1;
  const facility = await createFacility({
    name: 'Enugu Teaching Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${700_000 + sequence}`,
    stateId: state.id,
    addressLine: '3 Ogui Road, Enugu',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });

  const category = await createProfessionalCategory();
  const scheduler = await createUser({ fullName: 'Facility Scheduler' });
  await grant({
    userId: scheduler.id,
    roleKey: 'facility_scheduler',
    permissions: ['service_request.publish', 'assignment.confirm', 'attendance.record'],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });

  // Approving what a shift cost is a different act from scheduling it, so it
  // is a different grant even when one person holds both.
  const reviewer = await createUser({ fullName: 'Ward Manager' });
  await grant({
    userId: reviewer.id,
    roleKey: 'facility_approver',
    permissions: ['timesheet.approve', 'service_request.read'],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });

  const request = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: category.id,
    shiftType: 'DAY',
    startsAt: SHIFT_START,
    endsAt: SHIFT_END,
    headcount: 1,
    hourlyRateKobo: HOURLY_RATE_KOBO,
    urgency: 'ROUTINE',
    cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
    actorId: scheduler.id,
  });
  await publishServiceRequest({
    requestId: request.id,
    facilityId: facility.id,
    actorId: scheduler.id,
  });

  const practitioner = await createUser({ fullName: 'Chidi Okeke' });
  const [invitation] = await invitePractitioners({
    requestId: request.id,
    facilityId: facility.id,
    userIds: [practitioner.id],
    actorId: scheduler.id,
  });
  await respondToInvitation({
    invitationId: invitation!.id,
    userId: practitioner.id,
    decision: 'accept',
  });
  const assignment = await confirmAssignment({
    requestId: request.id,
    facilityId: facility.id,
    userId: practitioner.id,
    actorId: scheduler.id,
  });

  // The manual fallback, because it is the only way to put known times on a
  // record: the token path stamps whatever the clock says right now, and a
  // shift of nought minutes tests no arithmetic.
  await recordManualAttendance({
    assignmentId: assignment.id,
    actorId: scheduler.id,
    checkedInAt: WORKED_FROM,
    checkedOutAt: WORKED_TO,
    breakMinutes: 0,
    reason: 'Ward network was down for the whole shift; taken from the paper log.',
  });

  return {
    facilityId: facility.id,
    schedulerId: scheduler.id,
    reviewerId: reviewer.id,
    practitionerId: practitioner.id,
    assignmentId: assignment.id,
  };
}

beforeEach(() => {
  clearCookies();
});

describe('computing and submitting (7.4, 7.5)', () => {
  it('prices the hours at the rate the request agreed', async () => {
    const world = await buildWorld();

    const timesheet = await submitTimesheet({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
    });

    expect(timesheet.attendanceStatus).toBe('SUBMITTED');
    expect(timesheet.workedMinutes).toBe(480);
    expect(timesheet.billableMinutes).toBe(480);
    // Daytime on an ordinary Wednesday, and exactly the scheduled length.
    expect(timesheet.nightMinutes).toBe(0);
    expect(timesheet.holidayMinutes).toBe(0);
    expect(timesheet.overtimeMinutes).toBe(0);
    expect(timesheet.hourlyRateKobo).toBe(HOURLY_RATE_KOBO);
    // Eight hours at 5,000 naira, in kobo. Integers throughout (rule 3).
    expect(timesheet.amountKobo).toBe(4_000_000);
    expect(timesheet.revision).toBe(1);
  });

  it('records the submission as an event and an audit row', async () => {
    const world = await buildWorld();
    const timesheet = await submitTimesheet({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
    });

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: EVENTS.TimesheetSubmitted, aggregateId: timesheet.id },
    });
    expect(event).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'timesheet.submitted', entityId: timesheet.id },
    });
    expect(audit?.actorId).toBe(world.practitionerId);
  });

  it('refuses to submit a shift that was never checked out', async () => {
    const world = await buildWorld();
    await prisma.attendanceRecord.update({
      where: { assignmentId: world.assignmentId },
      data: { checkedOutAt: null },
    });

    await expect(
      submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId }),
    ).rejects.toThrow();
  });
});

describe('approval and rejection (7.5)', () => {
  it('refuses a rejection with no reason', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

    // The step's stated test. A rejection nobody can act on is worse than no
    // rejection: the practitioner has to know what to correct.
    await expect(
      reviewTimesheet({
        assignmentId: world.assignmentId,
        facilityId: world.facilityId,
        actorId: world.reviewerId,
        decision: 'reject',
      }),
    ).rejects.toThrow();

    const after = await getTimesheet(world.assignmentId);
    expect(after.attendanceStatus).toBe('SUBMITTED');
  });

  it('rejects with a reason, and the reason is on the record', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

    const rejected = await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'reject',
      reviewNotes: 'The break was an hour, not nought; the ward log shows it.',
    });

    expect(rejected.attendanceStatus).toBe('REJECTED');
    const record = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { assignmentId: world.assignmentId },
    });
    expect(record.reviewNotes).toContain('The break was an hour');
    expect(record.reviewedBy).toBe(world.reviewerId);

    // Still open. Nothing is completed by a rejection.
    const assignment = await getAssignment(world.assignmentId);
    expect(assignment?.status).toBe('CONFIRMED');
  });
});

describe('approval completes the assignment (7.5)', () => {
  it('reaches COMPLETED and publishes the event', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

    const approved = await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'approve',
    });
    expect(approved.attendanceStatus).toBe('APPROVED');

    // COMPLETED has been in the assignment enum since Stage 6 with nothing
    // reaching it. This is what reaches it.
    const assignment = await getAssignment(world.assignmentId);
    expect(assignment?.status).toBe('COMPLETED');

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: EVENTS.TimesheetApproved, aggregateId: approved.id },
    });
    expect(event).not.toBeNull();
  });

  it('will not let another facility approve the shift', async () => {
    const world = await buildWorld();
    const other = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

    await expect(
      reviewTimesheet({
        assignmentId: world.assignmentId,
        facilityId: other.facilityId,
        actorId: other.reviewerId,
        decision: 'approve',
      }),
    ).rejects.toThrow();
  });

  it('will not approve twice', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
    await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'approve',
    });

    await expect(
      reviewTimesheet({
        assignmentId: world.assignmentId,
        facilityId: world.facilityId,
        actorId: world.reviewerId,
        decision: 'approve',
      }),
    ).rejects.toThrow();
  });
});

describe('corrections (7.6)', () => {
  it('keeps the value it replaced, with who changed it and why', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
    const before = await getTimesheet(world.assignmentId);

    await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'reject',
      reviewNotes: 'An hour of it was a break.',
    });

    const corrected = await correctTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      breakMinutes: 60,
      reason: 'Ward log records a one hour break that the paper sheet omitted.',
    });

    expect(corrected.breakMinutes).toBe(60);
    expect(corrected.billableMinutes).toBe(420);
    expect(corrected.amountKobo).toBe(3_500_000);
    expect(corrected.revision).toBe(2);

    // The gate condition: no correction destroys the value it replaces.
    const revisions = await timesheetRevisions(world.assignmentId);
    expect(revisions).toHaveLength(1);
    const [first] = revisions;
    expect(first!.revision).toBe(1);
    expect(first!.actorId).toBe(world.reviewerId);
    expect(first!.reason).toContain('one hour break');

    const previous = first!.previous as Record<string, unknown>;
    expect(previous.billableMinutes).toBe(before.billableMinutes);
    expect(previous.amountKobo).toBe(before.amountKobo);
    expect(previous.breakMinutes).toBe(0);
    expect(previous.checkedInAt).toBe(WORKED_FROM.toISOString());
  });
});

describe('a correction to a time that has not come yet (ATT-04)', () => {
  it('is refused, and the sheet and its history are as they were', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
    await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'reject',
      reviewNotes: 'The check-out looks wrong.',
    });
    const before = await getTimesheet(world.assignmentId);

    await expect(
      correctTimesheet({
        assignmentId: world.assignmentId,
        facilityId: world.facilityId,
        actorId: world.reviewerId,
        checkedOutAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        reason: 'The nurse stayed on for the handover, which ran late.',
      }),
    ).rejects.toMatchObject({ code: 'time_in_future', status: 422 });

    const after = await getTimesheet(world.assignmentId);
    expect(after.revision).toBe(before.revision);
    expect(after.amountKobo).toBe(before.amountKobo);
    expect(after.attendanceStatus).toBe('REJECTED');
    expect(await timesheetRevisions(world.assignmentId)).toHaveLength(0);
  });

  it('still lets a break be corrected, which names no time', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
    await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'reject',
      reviewNotes: 'An hour of it was a break.',
    });

    const corrected = await correctTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      breakMinutes: 60,
      reason: 'Ward log records a one hour break that the paper sheet omitted.',
    });

    expect(corrected.billableMinutes).toBe(420);
  });
});

describe('corrections that follow one another (7.6)', () => {
  it('carries on-call minutes through a later recomputation', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

    const corrected = await correctTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      onCallMinutes: 120,
      reason: 'Two hours held on call after the shift, per the rota.',
    });
    expect(corrected.onCallMinutes).toBe(120);

    // On-call is the one figure no clock produces, so a resubmission must not
    // quietly drop it.
    const resubmitted = await submitTimesheet({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
    });
    expect(resubmitted.onCallMinutes).toBe(120);
  });

  it('goes back for approval, and every revision survives', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

    await correctTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      breakMinutes: 30,
      reason: 'Half an hour break, from the ward log.',
    });
    await correctTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      breakMinutes: 45,
      reason: 'Corrected again: the log says forty-five minutes.',
    });

    const revisions = await timesheetRevisions(world.assignmentId);
    expect(revisions.map((row) => row.revision)).toEqual([1, 2]);
    expect((revisions[0]!.previous as Record<string, unknown>).breakMinutes).toBe(0);
    expect((revisions[1]!.previous as Record<string, unknown>).breakMinutes).toBe(30);

    const resubmitted = await submitTimesheet({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
    });
    expect(resubmitted.attendanceStatus).toBe('SUBMITTED');
    expect(resubmitted.billableMinutes).toBe(435);

    const approved = await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'approve',
    });
    expect(approved.attendanceStatus).toBe('APPROVED');
    expect(approved.revision).toBe(3);
  });

  it('refuses a correction from a facility the shift does not belong to', async () => {
    const world = await buildWorld();
    const other = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

    await expect(
      correctTimesheet({
        assignmentId: world.assignmentId,
        facilityId: other.facilityId,
        actorId: other.reviewerId,
        breakMinutes: 60,
        reason: 'A facility with no stake in this shift trying to change it.',
      }),
    ).rejects.toThrow();
  });
});

describe('cold start ends here (6.4, 7.5)', () => {
  it('an approved shift becomes a completed assignment the matcher can count', async () => {
    const world = await buildWorld();

    const before = await assignmentOutcomes(world.practitionerId);
    expect(before).toEqual({ completed: 0, noShow: 0 });
    // Unproven, not unreliable — which the engine turns into a neutral score
    // rather than a penalty.
    expect(reliabilityFrom(before)).toBeNull();

    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
    await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'approve',
    });

    const after = await assignmentOutcomes(world.practitionerId);
    expect(after).toEqual({ completed: 1, noShow: 0 });
    expect(reliabilityFrom(after)).toBe(1);
  });
});

describe('the route table', () => {
  it('names a permission and a scope for every route', () => {
    expect(ROUTES.length).toBeGreaterThan(0);
    for (const route of ROUTES) {
      expect(route.permission).toBeTruthy();
      expect(['SELF', 'FACILITY', 'PLATFORM']).toContain(route.scopeType);
    }
  });

  it('keeps submission with the practitioner and review with the facility', () => {
    const submit = ROUTES.find((route) => route.path.endsWith('/timesheet/submit'));
    const review = ROUTES.find((route) => route.path.endsWith('/timesheet/review'));
    expect(submit?.scopeType).toBe('SELF');
    expect(submit?.permission).toBe('timesheet.submit');
    expect(review?.scopeType).toBe('FACILITY');
    expect(review?.permission).toBe('timesheet.approve');
  });
});

/**
 * Whose shift it is, asked before anything is read or written.
 *
 * The guard proves which scope a caller holds; it cannot know that the record
 * named in a URL path belongs to that scope. Two read routes took the id from
 * the path and the scope from the query, and the submit route declared the
 * caller's own SELF scope unconditionally, so one practitioner naming
 * another's assignment id was handed that person's hours, check-in times and
 * pay — and could submit their timesheet under their own name. These cases
 * exist so that cannot come back quietly.
 */
describe("somebody else's shift", () => {
  it("refuses a practitioner another practitioner's assignment, as a 404", async () => {
    const world = await buildWorld();
    const stranger = await createUser({ fullName: 'Ifeoma Nwosu' });

    await expect(
      getAssignmentInScope({
        assignmentId: world.assignmentId,
        scopeType: 'SELF',
        scopeId: stranger.id,
      }),
    ).rejects.toMatchObject({ code: 'assignment_not_found', status: 404 });

    // 404 rather than 403: a distinguishable refusal would confirm the id exists.
    await expect(
      getAssignmentInScope({
        assignmentId: world.assignmentId,
        scopeType: 'SELF',
        scopeId: world.practitionerId,
      }),
    ).resolves.toMatchObject({ id: world.assignmentId });
  });

  it("refuses a facility another facility's assignment", async () => {
    const world = await buildWorld();
    const other = await buildWorld();

    await expect(
      getAssignmentInScope({
        assignmentId: world.assignmentId,
        scopeType: 'FACILITY',
        scopeId: other.facilityId,
      }),
    ).rejects.toMatchObject({ code: 'assignment_not_found', status: 404 });

    await expect(
      getAssignmentInScope({
        assignmentId: world.assignmentId,
        scopeType: 'FACILITY',
        scopeId: world.facilityId,
      }),
    ).resolves.toMatchObject({ id: world.assignmentId });
  });

  it('lets a PLATFORM holder reach any of them, which is what PLATFORM is for', async () => {
    const world = await buildWorld();

    await expect(
      getAssignmentInScope({ assignmentId: world.assignmentId, scopeType: 'PLATFORM' }),
    ).resolves.toMatchObject({ id: world.assignmentId });
  });

  it('refuses a practitioner submitting a timesheet that is not theirs', async () => {
    const world = await buildWorld();
    const stranger = await createUser({ fullName: 'Ifeoma Nwosu' });

    await expect(
      submitTimesheet({ assignmentId: world.assignmentId, userId: stranger.id }),
    ).rejects.toMatchObject({ code: 'assignment_not_found', status: 404 });

    // Untouched: the refusal happens before anything is written.
    const record = await prisma.attendanceRecord.findFirstOrThrow({
      where: { assignmentId: world.assignmentId },
    });
    expect(record.status).not.toBe('SUBMITTED');
    expect(record.submittedBy).toBeNull();
  });
});

describe('two callers pricing the same shift at once', () => {
  it('both succeed and leave one timesheet', async () => {
    const world = await buildWorld();

    // The ShiftCompleted handler and a practitioner pressing Submit straight
    // after checking out. Read-then-create let one of them hit the unique
    // attendance_record_id and fail.
    const results = await Promise.allSettled([
      computeAndSaveTimesheet(world.assignmentId),
      computeAndSaveTimesheet(world.assignmentId),
      computeAndSaveTimesheet(world.assignmentId),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const assignment = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { assignmentId: world.assignmentId },
    });
    expect(await prisma.timesheet.count({ where: { attendanceRecordId: assignment.id } })).toBe(1);
  });
});

/**
 * M10-04: what a facility approves is what it is then paid for.
 *
 * The figures are worked out from the check-in and check-out, the rate on the request and the
 * holiday calendar, and then stored. The calendar is the one input that moves on its own: a
 * holiday is declared, or a mistaken one is taken away, after the hours were worked and
 * submitted. Approving the stored figures then pays a practitioner without a holiday that was
 * declared, or bills a facility for one that was not. And once a sheet is under review or
 * decided, a late ShiftCompleted event recomputing it from today's calendar changed it with no
 * revision and no audit row.
 */
describe('figures that change under a submitted timesheet (M10-04)', () => {
  /** The WAT date of the shift in `buildWorld`. */
  const WORKED_DATE = '2026-09-09';

  // Reference data survives the reset between tests, so what a test adds is taken away again.
  afterEach(async () => {
    await prisma.publicHoliday.deleteMany({ where: { owner: 'test' } });
  });

  const declareHoliday = (date: string) =>
    prisma.publicHoliday.create({
      data: { date: new Date(`${date}T00:00:00.000Z`), name: `Declared ${date}`, year: 2026, owner: 'test' },
    });

  const approve = (world: World) =>
    reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'approve',
    });

  it('refuses to approve hours priced before a holiday was declared, and shows the recalculated ones', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
    expect((await getTimesheet(world.assignmentId)).holidayMinutes).toBe(0);

    await declareHoliday(WORKED_DATE);

    await expect(approve(world)).rejects.toMatchObject({ code: 'timesheet_figures_changed', status: 409 });

    // Nothing was approved; the figures now say what the calendar says, and it is still waiting.
    const after = await getTimesheet(world.assignmentId);
    expect(after.attendanceStatus).toBe('SUBMITTED');
    expect(after.holidayMinutes).toBe(480);
    expect(after.revision).toBe(2);
    expect((await getAssignment(world.assignmentId))?.status).not.toBe('COMPLETED');

    // What it was is kept, with who asked and why, as every other change to a sheet is.
    const [kept] = await timesheetRevisions(world.assignmentId);
    expect(kept!.previous).toMatchObject({ holidayMinutes: 0, amountKobo: 4_000_000 });
    expect(kept!.actorId).toBe(world.reviewerId);
    expect(kept!.reason).toMatch(/recalculated/i);
    expect(await prisma.auditLog.count({ where: { action: 'timesheet.recalculated' } })).toBe(1);

    // Seen again, and approved.
    const approved = await approve(world);
    expect(approved.attendanceStatus).toBe('APPROVED');
    expect(approved.holidayMinutes).toBe(480);
  });

  it('does the same when a holiday is taken away after the hours were submitted', async () => {
    await declareHoliday(WORKED_DATE);
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
    expect((await getTimesheet(world.assignmentId)).holidayMinutes).toBe(480);

    await prisma.publicHoliday.deleteMany({ where: { owner: 'test' } });

    await expect(approve(world)).rejects.toMatchObject({ code: 'timesheet_figures_changed' });
    expect((await getTimesheet(world.assignmentId)).holidayMinutes).toBe(0);
    expect((await approve(world)).attendanceStatus).toBe('APPROVED');
  });

  it('approves at once, and writes nothing extra, when nothing has changed', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

    const approved = await approve(world);

    expect(approved.attendanceStatus).toBe('APPROVED');
    expect(approved.revision).toBe(1);
    expect(await timesheetRevisions(world.assignmentId)).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: 'timesheet.recalculated' } })).toBe(0);
  });

  it('rejects, with its reason, whatever the calendar says: only an approval is checked', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
    await declareHoliday(WORKED_DATE);

    const rejected = await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'reject',
      reviewNotes: 'The break is missing.',
    });

    expect(rejected.attendanceStatus).toBe('REJECTED');
  });

  describe('an approval from a screen drawn before the figures moved', () => {
    it('is refused whatever the figures are now, and an approval of the revision on file goes through', async () => {
      const world = await buildWorld();
      await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
      const seen = (await getTimesheet(world.assignmentId)).revision;
      await declareHoliday(WORKED_DATE);

      // The first approval, from a screen that showed the old figures, is refused and the
      // sheet is worked out again.
      await expect(approve(world)).rejects.toMatchObject({ code: 'timesheet_figures_changed' });
      const now = (await getTimesheet(world.assignmentId)).revision;
      expect(now).toBe(seen + 1);

      // A screen that did not reload still says the old revision: the figures are stable now,
      // and it is still not what that approver saw.
      await expect(
        reviewTimesheet({
          assignmentId: world.assignmentId,
          facilityId: world.facilityId,
          actorId: world.reviewerId,
          decision: 'approve',
          seenRevision: seen,
        }),
      ).rejects.toMatchObject({ code: 'timesheet_figures_changed', status: 409 });
      expect((await getTimesheet(world.assignmentId)).attendanceStatus).toBe('SUBMITTED');

      const approved = await reviewTimesheet({
        assignmentId: world.assignmentId,
        facilityId: world.facilityId,
        actorId: world.reviewerId,
        decision: 'approve',
        seenRevision: now,
      });
      expect(approved.attendanceStatus).toBe('APPROVED');
    });

    it('is carried by the route: a stale revision is a 409 with the code, the one on file is a 200', async () => {
      const world = await buildWorld();
      await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
      await issueSession({ userId: world.reviewerId });
      const { revision } = await getTimesheet(world.assignmentId);

      const call = async (seenRevision: number) => {
        const response = await reviewRoute(
          new Request(`http://localhost/api/v1/assignments/${world.assignmentId}/timesheet/review`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ facilityId: world.facilityId, decision: 'approve', seenRevision }),
          }),
          { params: Promise.resolve({ id: world.assignmentId }) },
        );
        return { status: response.status, body: (await response.json()) as { error?: { code?: string } } };
      };

      const stale = await call(revision + 1);
      expect(stale.status).toBe(409);
      expect(stale.body.error?.code).toBe('timesheet_figures_changed');

      const fresh = await call(revision);
      expect(fresh.status).toBe(200);
    });

    it('does not ask a caller that never showed a sheet to say which one', async () => {
      const world = await buildWorld();
      await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

      expect((await approve(world)).attendanceStatus).toBe('APPROVED');
    });
  });

  describe('a late recomputation, as a redelivered ShiftCompleted event does', () => {
    it('leaves a submitted sheet as the practitioner submitted it', async () => {
      const world = await buildWorld();
      await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
      await declareHoliday(WORKED_DATE);

      const view = await computeAndSaveTimesheet(world.assignmentId);

      expect(view.holidayMinutes).toBe(0);
      const stored = await getTimesheet(world.assignmentId);
      expect(stored.holidayMinutes).toBe(0);
      expect(stored.revision).toBe(1);
    });

    it('leaves an approved sheet as it was approved', async () => {
      const world = await buildWorld();
      await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
      const approved = await approve(world);
      await declareHoliday(WORKED_DATE);

      const view = await computeAndSaveTimesheet(world.assignmentId);

      expect(view.amountKobo).toBe(approved.amountKobo);
      const stored = await getTimesheet(world.assignmentId);
      expect(stored.holidayMinutes).toBe(0);
      expect(stored.attendanceStatus).toBe('APPROVED');
    });

    it('still works out a sheet that has not been submitted, which is what the event is for', async () => {
      const world = await buildWorld();
      await declareHoliday(WORKED_DATE);

      const view = await computeAndSaveTimesheet(world.assignmentId);

      expect(view.holidayMinutes).toBe(480);
    });

    it('still works out a rejected sheet again, so it can be resubmitted as it now stands', async () => {
      const world = await buildWorld();
      await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
      await reviewTimesheet({
        assignmentId: world.assignmentId,
        facilityId: world.facilityId,
        actorId: world.reviewerId,
        decision: 'reject',
        reviewNotes: 'Please look again.',
      });
      await declareHoliday(WORKED_DATE);

      const resubmitted = await submitTimesheet({
        assignmentId: world.assignmentId,
        userId: world.practitionerId,
      });

      expect(resubmitted.attendanceStatus).toBe('SUBMITTED');
      expect(resubmitted.holidayMinutes).toBe(480);
    });
  });
});
