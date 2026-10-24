import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { getAttendance, recordManualAttendance } from '@/modules/attendance/application/attendance';
import { reviewTimesheet, submitTimesheet } from '@/modules/timesheets/application/timesheet';
import {
  beginReview,
  getDispute,
  listDisputes,
  listDisputesFor,
  raiseDispute,
  resolveDispute,
  withdrawDispute,
} from '@/modules/disputes/application/dispute';
import {
  attachEvidence,
  requestEvidenceDownloadUrl,
  requestEvidenceUploadUrl,
} from '@/modules/disputes/application/evidence';
import { issueSession } from '@/modules/auth/application/session-service';
import { GET as listForAssignmentRoute } from '@/app/api/v1/assignments/[id]/disputes/route';
import { POST as evidenceUrlRoute } from '@/app/api/v1/disputes/[id]/evidence/[evidenceId]/url/route';
import { POST as evidenceUploadUrlRoute } from '@/app/api/v1/disputes/[id]/evidence/upload-url/route';
import { POST as attachEvidenceRoute } from '@/app/api/v1/disputes/[id]/evidence/route';
import { POST as withdrawDisputeRoute } from '@/app/api/v1/disputes/[id]/withdraw/route';
import { DISPUTE_WINDOW_DAYS } from '@/modules/disputes/domain/dispute';
import { ROUTES } from '@/modules/disputes/routes';
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
 * Module 14 — a case opened over a shift that has already been decided.
 *
 * What a pure function cannot cover is asserted here: that the case and the
 * shift's state move together, that a dismissal puts the record back exactly
 * where it was, that upholding sends it back to be decided again, and that an
 * adjudicator can resolve a case they are not allowed to open.
 */

const WORKED_FROM = new Date('2026-09-09T07:00:00.000Z');
const WORKED_TO = new Date('2026-09-09T15:00:00.000Z');
const SHIFT_START = new Date(Date.now() + 2 * 60 * 60 * 1000);
const SHIFT_END = new Date(SHIFT_START.getTime() + 8 * 60 * 60 * 1000);

let sequence = 0;

interface World {
  facilityId: string;
  schedulerId: string;
  reviewerId: string;
  officerId: string;
  practitionerId: string;
  assignmentId: string;
}

/** A shift worked, submitted and approved — the state a dispute starts from. */
async function buildWorld(): Promise<World> {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const verifier = await createUser({ fullName: 'Verifying Officer' });

  sequence += 1;
  const facility = await createFacility({
    name: 'Ibadan University Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${300_000 + sequence}`,
    stateId: state.id,
    addressLine: '2 Queen Elizabeth Road, Ibadan',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: verifier.id, decision: 'approve' });

  const category = await createProfessionalCategory();
  const scheduler = await createUser({ fullName: 'Facility Scheduler' });
  await grant({
    userId: scheduler.id,
    roleKey: 'facility_scheduler',
    permissions: ['service_request.publish', 'assignment.confirm', 'attendance.record'],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });

  const reviewer = await createUser({ fullName: 'Ward Manager' });
  await grant({
    userId: reviewer.id,
    roleKey: 'facility_approver',
    permissions: ['timesheet.approve', 'service_request.read', 'dispute.manage'],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });

  // The adjudicator. Holds dispute.manage at PLATFORM, which lets them
  // resolve a case and — deliberately — not open one.
  const officer = await createUser({ fullName: 'Disputes Officer' });
  await grant({
    userId: officer.id,
    roleKey: 'operations_officer',
    permissions: ['dispute.manage'],
    scopeType: 'PLATFORM',
  });

  const request = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: category.id,
    shiftType: 'DAY',
    startsAt: SHIFT_START,
    endsAt: SHIFT_END,
    headcount: 1,
    hourlyRateKobo: 500_000,
    urgency: 'ROUTINE',
    cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
    actorId: scheduler.id,
  });
  await publishServiceRequest({
    requestId: request.id,
    facilityId: facility.id,
    actorId: scheduler.id,
  });

  const practitioner = await createUser({ fullName: 'Ngozi Eze' });
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
    officerId: officer.id,
    practitionerId: practitioner.id,
    assignmentId: assignment.id,
  };
}

/** Carries the shift all the way to APPROVED, which is what can be disputed. */
async function approved(world: World) {
  await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
  return reviewTimesheet({
    assignmentId: world.assignmentId,
    facilityId: world.facilityId,
    actorId: world.reviewerId,
    decision: 'approve',
  });
}

/** And to REJECTED, the other disputable state. */
async function rejected(world: World) {
  await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
  return reviewTimesheet({
    assignmentId: world.assignmentId,
    facilityId: world.facilityId,
    actorId: world.reviewerId,
    decision: 'reject',
    reviewNotes: 'The break was an hour, not nought; the ward log shows it.',
  });
}

const COMPLAINT = 'The approved hours are two short: I stayed until the night staff arrived.';

beforeEach(() => {
  clearCookies();
});

describe('opening a case', () => {
  it('moves the shift to DISPUTED and remembers where it came from', async () => {
    const world = await buildWorld();
    await approved(world);

    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: COMPLAINT,
    });

    expect(dispute.status).toBe('OPEN');
    expect(dispute.raisedParty).toBe('PRACTITIONER');
    expect(dispute.outcome).toBeNull();

    const attendance = await getAttendance(world.assignmentId);
    expect(attendance.status).toBe('DISPUTED');

    // Remembered on the attendance record, because putting it back is
    // attendance's invariant rather than the case file's.
    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { assignmentId: world.assignmentId },
    });
    expect(row.preDisputeStatus).toBe('APPROVED');
  });

  it('publishes DisputeOpened and writes an audit row', async () => {
    const world = await buildWorld();
    await approved(world);
    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: COMPLAINT,
    });

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: EVENTS.DisputeOpened, aggregateId: dispute.id },
    });
    expect(event).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'dispute.opened', entityId: dispute.id },
    });
    expect(audit?.actorId).toBe(world.practitionerId);
  });

  it('lets the facility raise one too, as the other party', async () => {
    const world = await buildWorld();
    await approved(world);

    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.reviewerId,
      facilityId: world.facilityId,
      category: 'CONDUCT',
      reason: 'The practitioner left two hours before the end of the shift.',
    });
    expect(dispute.raisedParty).toBe('FACILITY');
  });

  it('refuses somebody who is on neither side of the shift', async () => {
    const world = await buildWorld();
    await approved(world);

    // The officer holds dispute.manage at PLATFORM and still cannot open a
    // case: one nobody involved wanted is not a dispute, it is an audit. And the
    // answer is "not found", not a list of what is wrong with the shift: it used
    // to be a 409 naming the blockers, which confirmed to an outsider that the
    // shift exists and what state it was in (AUT-10).
    await expect(
      raiseDispute({
        assignmentId: world.assignmentId,
        actorId: world.officerId,
        category: 'HOURS',
        reason: COMPLAINT,
      }),
    ).rejects.toMatchObject({ code: 'assignment_not_found', status: 404 });
  });

  it('tells a facility that has nothing to do with the shift that there is no such shift, not why it was refused', async () => {
    const world = await buildWorld();
    const other = await buildWorld();
    await approved(world);

    await expect(
      raiseDispute({
        assignmentId: world.assignmentId,
        actorId: other.reviewerId,
        facilityId: other.facilityId,
        category: 'HOURS',
        reason: COMPLAINT,
      }),
    ).rejects.toMatchObject({ code: 'assignment_not_found', status: 404 });
  });

  it('refuses a shift nobody has decided yet', async () => {
    const world = await buildWorld();
    await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });

    await expect(
      raiseDispute({
        assignmentId: world.assignmentId,
        actorId: world.practitionerId,
        category: 'HOURS',
        reason: COMPLAINT,
      }),
    ).rejects.toThrow(/not_yet_decided/);
  });

  it('refuses a second open case over one shift', async () => {
    const world = await buildWorld();
    await approved(world);
    await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: COMPLAINT,
    });

    await expect(
      raiseDispute({
        assignmentId: world.assignmentId,
        actorId: world.reviewerId,
        facilityId: world.facilityId,
        category: 'CONDUCT',
        reason: 'A second complaint while the first is still being worked.',
      }),
    ).rejects.toThrow(/already_open/);
  });

  it('refuses one raised after the window has closed', async () => {
    const world = await buildWorld();
    await approved(world);

    // The decision, pushed back beyond the fortnight. The window runs from
    // the decision rather than from the shift.
    await prisma.attendanceRecord.update({
      where: { assignmentId: world.assignmentId },
      data: {
        reviewedAt: new Date(Date.now() - (DISPUTE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000),
      },
    });

    await expect(
      raiseDispute({
        assignmentId: world.assignmentId,
        actorId: world.practitionerId,
        category: 'HOURS',
        reason: COMPLAINT,
      }),
    ).rejects.toThrow(/outside_window/);
  });

  it('can be raised over a rejection as well as an approval', async () => {
    const world = await buildWorld();
    await rejected(world);

    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: 'There was no break at all; the ward was two staff short that day.',
    });
    expect(dispute.status).toBe('OPEN');

    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { assignmentId: world.assignmentId },
    });
    expect(row.preDisputeStatus).toBe('REJECTED');
  });
});

describe('telling people what happens to a case', () => {
  /**
   * The admin screen says marking a case under review "tells the other side
   * somebody is looking" and that both sides read the outcome. Neither was
   * true: only DisputeOpened was published, and nothing consumed it.
   */
  const eventsFor = (disputeId: string) =>
    prisma.outboxEvent.findMany({ where: { aggregateId: disputeId }, orderBy: { createdAt: 'asc' } });

  it('publishes DisputeUnderReview when an officer picks it up', async () => {
    const world = await buildWorld();
    await approved(world);
    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: COMPLAINT,
    });

    await beginReview({ disputeId: dispute.id, actorId: world.officerId });

    const event = (await eventsFor(dispute.id)).find((e) => e.eventType === EVENTS.DisputeUnderReview);
    expect(event?.payload).toMatchObject({
      disputeId: dispute.id,
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
      facilityId: world.facilityId,
    });
  });

  it('publishes DisputeResolved with the outcome, and not the officer\'s notes', async () => {
    const world = await buildWorld();
    await approved(world);
    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: COMPLAINT,
    });

    await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'UPHELD',
      decisionReason: 'RECORD_WAS_WRONG',
      notes: 'The ward log shows the practitioner stayed until the night staff arrived.',
    });

    const event = (await eventsFor(dispute.id)).find((e) => e.eventType === EVENTS.DisputeResolved);
    expect(event?.payload).toMatchObject({ disputeId: dispute.id, outcome: 'UPHELD' });
    expect(JSON.stringify(event?.payload)).not.toContain('night staff');
  });

  it('publishes DisputeWithdrawn, saying which side withdrew it', async () => {
    const world = await buildWorld();
    await approved(world);
    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: COMPLAINT,
    });

    await withdrawDispute({ disputeId: dispute.id, actorId: world.practitionerId });

    const event = (await eventsFor(dispute.id)).find((e) => e.eventType === EVENTS.DisputeWithdrawn);
    expect(event?.payload).toMatchObject({ disputeId: dispute.id, raisedParty: 'PRACTITIONER' });
  });
});

describe('resolving a case', () => {
  async function openCase(world: World) {
    await approved(world);
    return raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: COMPLAINT,
    });
  }

  it('dismissed puts the shift back exactly where it was', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);

    const resolved = await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'DISMISSED',
      decisionReason: 'RECORD_CONFIRMED',
      notes: 'The ward diary shows the handover finished at four, as recorded.',
    });

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.outcome).toBe('DISMISSED');
    expect(resolved.resolvedBy).toBe(world.officerId);

    const attendance = await getAttendance(world.assignmentId);
    expect(attendance.status).toBe('APPROVED');

    // And the memory is cleared, so a later dispute records its own.
    const row = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { assignmentId: world.assignmentId },
    });
    expect(row.preDisputeStatus).toBeNull();
  });

  it('a dismissed dispute over a rejection restores the rejection', async () => {
    const world = await buildWorld();
    await rejected(world);
    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: 'There was no break at all; the ward was two staff short that day.',
    });

    await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'DISMISSED',
      decisionReason: 'RECORD_CONFIRMED',
      notes: 'The ward log does record a break, and the practitioner signed it.',
    });

    // Not APPROVED — back to where it actually was.
    const attendance = await getAttendance(world.assignmentId);
    expect(attendance.status).toBe('REJECTED');
  });

  it('upheld sends the figures back to be decided again', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);

    await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'UPHELD',
      decisionReason: 'RECORD_WAS_WRONG',
      notes: 'Ward diary confirms the practitioner stayed for the handover.',
    });

    const attendance = await getAttendance(world.assignmentId);
    expect(attendance.status).toBe('SUBMITTED');

    // Upholding does not itself rewrite the hours: the facility corrects the
    // timesheet through the ordinary route, so the change lands in
    // timesheet_revisions where somebody can see it.
    const approvedAgain = await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'approve',
    });
    expect(approvedAgain.attendanceStatus).toBe('APPROVED');
  });

  it('does not count the shift twice after a dispute round trip', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);
    await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'UPHELD',
      decisionReason: 'RECORD_WAS_WRONG',
      notes: 'Ward diary confirms the practitioner stayed for the handover.',
    });
    await reviewTimesheet({
      assignmentId: world.assignmentId,
      facilityId: world.facilityId,
      actorId: world.reviewerId,
      decision: 'approve',
    });

    // One shift, approved twice. Completing an already-completed assignment
    // is a no-op, so the reliability count must not have moved — otherwise
    // disputing your own shift and winning would inflate your record.
    const outcomes = await assignmentOutcomes(world.practitionerId);
    expect(outcomes).toEqual({ completed: 1, noShow: 0 });

    const completions = await prisma.assignmentStatusHistory.count({
      where: { assignmentId: world.assignmentId, toStatus: 'COMPLETED' },
    });
    expect(completions).toBe(1);
  });

  it('refuses to resolve without an outcome', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);

    await expect(
      resolveDispute({
        disputeId: dispute.id,
        actorId: world.officerId,
        outcome: null,
        decisionReason: null,
        notes: 'Closing this without deciding which way it went.',
      }),
    ).rejects.toThrow(/outcome_missing/);

    expect((await getAttendance(world.assignmentId)).status).toBe('DISPUTED');
  });

  it('refuses to resolve without a reason', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);

    await expect(
      resolveDispute({
        disputeId: dispute.id,
        actorId: world.officerId,
        outcome: 'DISMISSED',
        decisionReason: 'RECORD_CONFIRMED',
        notes: 'no',
      }),
    ).rejects.toThrow(/notes_missing/);
  });

  it('will not resolve the same case twice', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);
    await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'DISMISSED',
      decisionReason: 'RECORD_CONFIRMED',
      notes: 'The ward diary shows the handover finished at four, as recorded.',
    });

    await expect(
      resolveDispute({
        disputeId: dispute.id,
        actorId: world.officerId,
        outcome: 'UPHELD',
        decisionReason: 'RECORD_WAS_WRONG',
        notes: 'Changing the finding after the fact.',
      }),
    ).rejects.toThrow(/not_open/);
  });

  it('can be picked up for review first, and still resolved', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);

    const claimed = await beginReview({ disputeId: dispute.id, actorId: world.officerId });
    expect(claimed.status).toBe('UNDER_REVIEW');

    const resolved = await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'DISMISSED',
      decisionReason: 'RECORD_CONFIRMED',
      notes: 'The ward diary shows the handover finished at four, as recorded.',
    });
    expect(resolved.status).toBe('RESOLVED');
  });

  it('shows on the adjudicator queue until it is resolved', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);

    expect((await listDisputes()).disputes.map((row) => row.id)).toContain(dispute.id);

    await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'DISMISSED',
      decisionReason: 'RECORD_CONFIRMED',
      notes: 'The ward diary shows the handover finished at four, as recorded.',
    });

    expect((await listDisputes()).disputes.map((row) => row.id)).not.toContain(dispute.id);
    // Resolved cases are still reachable — the point of moving beyond a
    // hard-wired "live only" queue — just not under the live default.
    expect((await listDisputes({ status: 'RESOLVED' })).disputes.map((row) => row.id)).toContain(
      dispute.id,
    );
  });
});

describe('withdrawing, and disputing again', () => {
  async function openCase(world: World) {
    await approved(world);
    return raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: COMPLAINT,
    });
  }

  it('restores the shift and keeps the row', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);

    const withdrawn = await withdrawDispute({
      disputeId: dispute.id,
      actorId: world.practitionerId,
    });
    expect(withdrawn.status).toBe('WITHDRAWN');
    expect(withdrawn.withdrawnAt).not.toBeNull();
    // The complaint itself survives. A case that vanished would take the
    // other party's side of the story with it.
    expect(withdrawn.reason).toBe(COMPLAINT);

    expect((await getAttendance(world.assignmentId)).status).toBe('APPROVED');
  });

  it('is only for the party who raised it', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);

    await expect(
      withdrawDispute({ disputeId: dispute.id, actorId: world.reviewerId }),
    ).rejects.toThrow(/not_the_raiser/);
  });

  it('lets a shift be disputed again after a dismissal, and keeps both', async () => {
    const world = await buildWorld();
    const first = await openCase(world);
    await resolveDispute({
      disputeId: first.id,
      actorId: world.officerId,
      outcome: 'DISMISSED',
      decisionReason: 'RECORD_CONFIRMED',
      notes: 'Nothing was produced to support the claim at the time.',
    });

    const second = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: 'Attaching the ward diary now that the unit has released it.',
    });
    expect(second.status).toBe('OPEN');

    const all = await listDisputesFor(world.assignmentId, world.officerId);
    expect(all.map((row) => row.status)).toEqual(['RESOLVED', 'OPEN']);
    expect(all[0]!.outcome).toBe('DISMISSED');
  });

  it('will not withdraw a case already resolved', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);
    await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'DISMISSED',
      decisionReason: 'RECORD_CONFIRMED',
      notes: 'The ward diary shows the handover finished at four, as recorded.',
    });

    await expect(
      withdrawDispute({ disputeId: dispute.id, actorId: world.practitionerId }),
    ).rejects.toThrow(/not_open/);
  });

  it('reads a case back with its outcome and reason intact', async () => {
    const world = await buildWorld();
    const dispute = await openCase(world);
    await resolveDispute({
      disputeId: dispute.id,
      actorId: world.officerId,
      outcome: 'UPHELD',
      decisionReason: 'RECORD_WAS_WRONG',
      notes: 'Ward diary confirms the practitioner stayed for the handover.',
    });

    const read = await getDispute(dispute.id);
    expect(read.outcome).toBe('UPHELD');
    expect(read.resolutionNotes).toContain('stayed for the handover');
    expect(read.reason).toBe(COMPLAINT);
    expect(read.userId).toBe(world.practitionerId);
    expect(read.facilityId).toBe(world.facilityId);
  });
});

describe('the route table', () => {
  it('names dispute.manage everywhere and separates the sides by scope', () => {
    expect(ROUTES.length).toBeGreaterThan(0);
    for (const route of ROUTES) {
      expect(route.permission).toBe('dispute.manage');
      expect(['SELF', 'FACILITY', 'PLATFORM']).toContain(route.scopeType);
    }
  });

  it('adjudicates at PLATFORM and withdraws at SELF', () => {
    const resolve = ROUTES.find((route) => route.path.endsWith('/resolve'));
    const withdraw = ROUTES.find((route) => route.path.endsWith('/withdraw'));
    expect(resolve?.scopeType).toBe('PLATFORM');
    expect(withdraw?.scopeType).toBe('SELF');
  });

  it('lets either party open a case', () => {
    const open = ROUTES.filter(
      (route) => route.method === 'POST' && route.path.endsWith('/assignments/:id/disputes'),
    );
    expect(open.map((route) => route.scopeType).sort()).toEqual(['FACILITY', 'SELF']);
  });
});

describe('who may see a case and what is attached to it', () => {
  /**
   * `dispute.manage` is held by practitioners (at SELF), facility owners and
   * approvers (at FACILITY) and officers (at PLATFORM). The permission alone
   * says nothing about *this* case, and the evidence is the most sensitive
   * thing the module holds — a ward photograph, a medical letter. Everything
   * below is about the case a person has no part in.
   */
  const PHOTO = { filename: 'ward-log.jpg', contentType: 'image/jpeg', sizeBytes: 120_000 };

  async function selfGrant(userId: string) {
    await grant({
      userId,
      roleKey: `practitioner_self_${userId}`,
      permissions: ['dispute.manage'],
      scopeType: 'SELF',
      scopeId: userId,
    });
  }

  /** A case with one photograph attached by the practitioner. */
  async function caseWithEvidence() {
    const world = await buildWorld();
    await approved(world);
    await selfGrant(world.practitionerId);
    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.practitionerId,
      category: 'HOURS',
      reason: COMPLAINT,
    });
    const upload = await requestEvidenceUploadUrl({
      disputeId: dispute.id,
      userId: world.practitionerId,
      ...PHOTO,
    });
    const evidence = await attachEvidence({
      disputeId: dispute.id,
      userId: world.practitionerId,
      objectKey: upload.objectKey,
      note: 'The ward log, photographed.',
    });
    return { world, dispute, evidence };
  }

  /** Somebody at another facility, and another practitioner, both with dispute.manage. */
  async function outsiders() {
    const other = await buildWorld();
    await selfGrant(other.practitionerId);
    return { otherPractitioner: other.practitionerId, otherReviewer: other.reviewerId };
  }

  it('lets the practitioner and the facility attach evidence', async () => {
    const { world, dispute } = await caseWithEvidence();

    const facilityUpload = await requestEvidenceUploadUrl({
      disputeId: dispute.id,
      userId: world.reviewerId,
      ...PHOTO,
    });
    await expect(
      attachEvidence({
        disputeId: dispute.id,
        userId: world.reviewerId,
        objectKey: facilityUpload.objectKey,
      }),
    ).resolves.toMatchObject({ attachedBy: world.reviewerId });
  });

  it('answers "not found" to an upload URL request from somebody on neither side of the shift', async () => {
    const { dispute } = await caseWithEvidence();
    const { otherPractitioner, otherReviewer } = await outsiders();

    for (const userId of [otherPractitioner, otherReviewer]) {
      await expect(
        requestEvidenceUploadUrl({ disputeId: dispute.id, userId, ...PHOTO }),
      ).rejects.toMatchObject({ status: 404 });
    }
    // Nothing was recorded on their behalf.
    expect(await prisma.storedObject.count({ where: { ownerUserId: otherReviewer } })).toBe(0);
  });

  it("refuses an outsider attaching their own file to somebody else's case", async () => {
    const { dispute } = await caseWithEvidence();
    const { otherPractitioner } = await outsiders();
    // They can ask storage for a URL for a case of their own, so they hold a
    // genuine object of the right purpose — it is the case that is not theirs.
    const stored = await prisma.storedObject.create({
      data: {
        bucket: 'test',
        objectKey: `dispute_evidence/test/${otherPractitioner}/x.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 100,
        purpose: 'dispute_evidence',
        ownerUserId: otherPractitioner,
        scopeType: 'SELF',
        scopeId: otherPractitioner,
      },
    });

    await expect(
      attachEvidence({
        disputeId: dispute.id,
        userId: otherPractitioner,
        objectKey: stored.objectKey,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await prisma.disputeEvidence.count({ where: { disputeId: dispute.id } })).toBe(1);
  });

  it('does not let the adjudicator attach evidence — they weigh it, they do not produce it', async () => {
    const { world, dispute } = await caseWithEvidence();
    await expect(
      requestEvidenceUploadUrl({ disputeId: dispute.id, userId: world.officerId, ...PHOTO }),
    ).rejects.toMatchObject({ code: 'dispute_not_a_party' });
  });

  it('gives each party and the adjudicator a link to the evidence, and nobody else', async () => {
    const { world, dispute, evidence } = await caseWithEvidence();
    const { otherPractitioner, otherReviewer } = await outsiders();

    for (const viewerId of [world.practitionerId, world.reviewerId, world.officerId]) {
      await expect(
        requestEvidenceDownloadUrl({ disputeId: dispute.id, evidenceId: evidence.id, viewerId }),
      ).resolves.toHaveProperty('url');
    }
    for (const viewerId of [otherPractitioner, otherReviewer]) {
      await expect(
        requestEvidenceDownloadUrl({ disputeId: dispute.id, evidenceId: evidence.id, viewerId }),
      ).rejects.toMatchObject({ status: 404 });
    }
    // The refusals left no "read" in the audit trail to suggest a download happened.
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'dispute.evidence_read',
          actorId: { in: [otherPractitioner, otherReviewer] },
        },
      }),
    ).toBe(0);
  });

  it('authorises the facility side through the upload, attach and download routes', async () => {
    const { world, dispute, evidence } = await caseWithEvidence();
    await issueSession({ userId: world.reviewerId });

    const uploadResponse = await evidenceUploadUrlRoute(
      new Request(`http://localhost/api/v1/disputes/${dispute.id}/evidence/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ ...PHOTO, facilityId: world.facilityId }),
      }),
      { params: Promise.resolve({ id: dispute.id }) },
    );
    expect(uploadResponse.status).toBe(200);
    const upload = (await uploadResponse.json()) as { objectKey: string };

    const attachResponse = await attachEvidenceRoute(
      new Request(`http://localhost/api/v1/disputes/${dispute.id}/evidence`, {
        method: 'POST',
        body: JSON.stringify({
          facilityId: world.facilityId,
          objectKey: upload.objectKey,
          note: 'The facility copy of the ward log.',
        }),
      }),
      { params: Promise.resolve({ id: dispute.id }) },
    );
    expect(attachResponse.status).toBe(200);

    const downloadResponse = await evidenceUrlRoute(
      new Request(`http://localhost/api/v1/disputes/${dispute.id}/evidence/${evidence.id}/url`, {
        method: 'POST',
        body: JSON.stringify({ facilityId: world.facilityId }),
      }),
      { params: Promise.resolve({ id: dispute.id, evidenceId: evidence.id }) },
    );
    expect(downloadResponse.status).toBe(200);
  });

  it('lets the facility withdraw a case it raised through the route', async () => {
    const world = await buildWorld();
    await approved(world);
    const dispute = await raiseDispute({
      assignmentId: world.assignmentId,
      actorId: world.reviewerId,
      facilityId: world.facilityId,
      category: 'HOURS',
      reason: 'The ward has now found the signed paper record and no longer disputes the hours.',
    });
    await issueSession({ userId: world.reviewerId });

    const response = await withdrawDisputeRoute(
      new Request(`http://localhost/api/v1/disputes/${dispute.id}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ facilityId: world.facilityId }),
      }),
      { params: Promise.resolve({ id: dispute.id }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'WITHDRAWN' });
  });

  it("will not serve evidence from a different case under this case's path", async () => {
    const first = await caseWithEvidence();
    const second = await caseWithEvidence();

    // The second case's own practitioner, naming their own case id but the
    // first case's evidence id.
    await expect(
      requestEvidenceDownloadUrl({
        disputeId: second.dispute.id,
        evidenceId: first.evidence.id,
        viewerId: second.world.practitionerId,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('shows the cases over a shift to its parties and the adjudicator only', async () => {
    const { world } = await caseWithEvidence();
    const { otherPractitioner, otherReviewer } = await outsiders();

    for (const viewerId of [world.practitionerId, world.reviewerId, world.officerId]) {
      await expect(listDisputesFor(world.assignmentId, viewerId)).resolves.toHaveLength(1);
    }
    for (const viewerId of [otherPractitioner, otherReviewer]) {
      await expect(listDisputesFor(world.assignmentId, viewerId)).rejects.toMatchObject({
        status: 404,
      });
    }
  });

  it('refuses a stranger over the routes, whatever scope they name', async () => {
    const { world, dispute, evidence } = await caseWithEvidence();
    const { otherPractitioner } = await outsiders();

    const list = (scope: string) =>
      listForAssignmentRoute(
        new Request(
          `http://localhost/api/v1/assignments/${world.assignmentId}/disputes?scopeType=${scope}`,
        ),
        { params: Promise.resolve({ id: world.assignmentId }) },
      );
    const link = () =>
      evidenceUrlRoute(
        new Request(`http://localhost/api/v1/disputes/${dispute.id}/evidence/${evidence.id}/url`, {
          method: 'POST',
          body: '{}',
        }),
        { params: Promise.resolve({ id: dispute.id, evidenceId: evidence.id }) },
      );

    await issueSession({ userId: otherPractitioner });
    // Their own SELF scope passes the guard — and the application says no.
    expect((await list('SELF')).status).toBe(404);
    expect((await link()).status).toBe(404);

    await issueSession({ userId: world.practitionerId });
    const own = await list('SELF');
    expect(own.status).toBe(200);
    expect((await own.json()).disputes).toHaveLength(1);
    expect((await link()).status).toBe(200);
  });
});
