import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { reliabilityFrom } from '@/modules/matching/domain/reliability';
import { recordManualAttendance } from '@/modules/attendance/application/attendance';
import {
  correctTimesheet,
  getTimesheet,
  reviewTimesheet,
  submitTimesheet,
  timesheetRevisions,
} from '@/modules/timesheets/application/timesheet';
import { ROUTES } from '@/modules/timesheets/routes';
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
