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
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import {
  getAttendance,
  issueCheckInToken,
  listCheckInEvents,
  presentCheckInToken,
  recordManualAttendance,
} from '@/modules/attendance/application/attendance';
import { qrPayload } from '@/modules/attendance/domain/check-in-token';
import { ROUTES } from '@/modules/attendance/routes';
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
 * Steps 7.1, 7.2 and 7.3 — the state machine wired to real records, the
 * token round trip, and the manual fallback.
 *
 * The state machine's own exhaustiveness is unit-tested over all 81 pairs;
 * what is asserted here is that nothing in the application layer can move a
 * record except through it.
 */

const SHIFT_START = new Date(Date.now() + 2 * 60 * 60 * 1000);
const SHIFT_END = new Date(SHIFT_START.getTime() + 8 * 60 * 60 * 1000);

/**
 * A manual record is written after the fact, from a paper log, so its times
 * are in the past — which is what makes recordedAt later than occurredAt.
 */
const PAST_START = new Date(Date.now() - 26 * 60 * 60 * 1000);
const PAST_END = new Date(PAST_START.getTime() + 8 * 60 * 60 * 1000);

let sequence = 0;

interface World {
  facilityId: string;
  schedulerId: string;
  practitionerId: string;
  assignmentId: string;
}

/** A confirmed assignment — everything Stage 6 leaves behind. */
async function buildWorld(): Promise<World> {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const officer = await createUser({ fullName: 'Compliance Officer' });

  sequence += 1;
  const facility = await createFacility({
    name: 'Owerri General Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${500_000 + sequence}`,
    stateId: state.id,
    addressLine: '14 Wetheral Road, Owerri',
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

  const practitioner = await createUser({ fullName: 'Amina Yusuf' });
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

  return {
    facilityId: facility.id,
    schedulerId: scheduler.id,
    practitionerId: practitioner.id,
    assignmentId: assignment.id,
  };
}

/** Issue and present, which is the ordinary path. */
async function checkIn(world: World) {
  const token = await issueCheckInToken({
    assignmentId: world.assignmentId,
    purpose: 'CHECK_IN',
    actorId: world.schedulerId,
  });
  return presentCheckInToken({
    assignmentId: world.assignmentId,
    purpose: 'CHECK_IN',
    code: token.code,
    userId: world.practitionerId,
  });
}

beforeEach(() => {
  clearCookies();
});

describe('the token round trip', () => {
  it('moves a shift from not started to checked in and out', async () => {
    const world = await buildWorld();

    expect((await checkIn(world)).status).toBe('CHECKED_IN');

    const outToken = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_OUT',
      actorId: world.schedulerId,
    });
    const out = await presentCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_OUT',
      code: outToken.code,
      userId: world.practitionerId,
    });

    expect(out.status).toBe('CHECKED_OUT');
    expect(out.checkedInAt).not.toBeNull();
    expect(out.checkedOutAt).not.toBeNull();
  });

  it('accepts the same secret scanned as a QR', async () => {
    const world = await buildWorld();
    const token = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });

    // Two renderings of one secret, not two systems.
    const result = await presentCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      code: token.qr,
      userId: world.practitionerId,
    });

    expect(result.status).toBe('CHECKED_IN');
    const events = await listCheckInEvents(world.assignmentId);
    expect(events[0]?.method).toBe('QR');
  });

  it('records which method was used', async () => {
    const world = await buildWorld();
    await checkIn(world);

    const events = await listCheckInEvents(world.assignmentId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'CHECK_IN', method: 'SUPERVISOR_CODE' });
  });

  it('publishes shift.started and shift.completed', async () => {
    const world = await buildWorld();
    await checkIn(world);
    const outToken = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_OUT',
      actorId: world.schedulerId,
    });
    await presentCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_OUT',
      code: outToken.code,
      userId: world.practitionerId,
    });

    const kinds = (
      await prisma.outboxEvent.findMany({
        where: { eventType: { in: [EVENTS.ShiftStarted, EVENTS.ShiftCompleted] } },
      })
    ).map((event) => event.eventType);
    expect(kinds.sort()).toEqual([EVENTS.ShiftCompleted, EVENTS.ShiftStarted].sort());
  });
});

describe('the token refuses what it should', () => {
  it('refuses a wrong code and counts the attempt', async () => {
    const world = await buildWorld();
    await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });

    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: '000000',
        userId: world.practitionerId,
      }),
    ).rejects.toThrow(/not usable/);

    // Counted before the caller learns the result, so abandoning the request
    // mid-flight does not buy a free guess.
    const token = await prisma.checkInToken.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    expect(token.attempts).toBe(1);
  });

  it('refuses a code that has already been used', async () => {
    const world = await buildWorld();
    const token = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });
    await presentCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      code: token.code,
      userId: world.practitionerId,
    });

    // Already CHECKED_IN, so the state machine stops it before the token does.
    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: token.code,
        userId: world.practitionerId,
      }),
    ).rejects.toThrow(/cannot move from CHECKED_IN/);
  });

  it('refuses an expired code', async () => {
    const world = await buildWorld();
    const token = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });

    await prisma.checkInToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: token.code,
        userId: world.practitionerId,
      }),
    ).rejects.toThrow(/expired/);
  });

  it('supersedes an earlier code when a new one is issued', async () => {
    const world = await buildWorld();
    const first = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });
    await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });

    // A stale code read out earlier must not work after a new one is issued.
    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: first.code,
        userId: world.practitionerId,
      }),
    ).rejects.toThrow(/not usable/);
  });

  it("refuses a QR payload naming another shift", async () => {
    const world = await buildWorld();
    const other = await buildWorld();
    // This practitioner has a live shift of their own, and scans somebody
    // else's code — which is the realistic version of this mistake.
    await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });
    const token = await issueCheckInToken({
      assignmentId: other.assignmentId,
      purpose: 'CHECK_IN',
      actorId: other.schedulerId,
    });

    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: qrPayload(other.assignmentId, 'CHECK_IN', token.code),
        userId: world.practitionerId,
      }),
    ).rejects.toThrow(/another shift/);
  });

  it('refuses checking out before checking in', async () => {
    const world = await buildWorld();

    // The state machine stops it: NOT_STARTED cannot become CHECKED_OUT.
    await expect(
      issueCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_OUT',
        actorId: world.schedulerId,
      }),
    ).rejects.toThrow(/not been checked in/);
  });

  it('refuses attendance against an assignment that was cancelled', async () => {
    const world = await buildWorld();
    await prisma.assignment.update({
      where: { id: world.assignmentId },
      data: { status: 'CANCELLED' },
    });

    await expect(
      issueCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        actorId: world.schedulerId,
      }),
    ).rejects.toThrow(/not_confirmed|confirmed assignment/);
  });
});

describe('step 7.3 — recordable when the network fails', () => {
  it('records a whole shift by hand, with a reason', async () => {
    const world = await buildWorld();

    // The gate condition: "a shift is recordable when the network fails at
    // the facility". Server-side that means no token could be exchanged.
    const result = await recordManualAttendance({
      assignmentId: world.assignmentId,
      actorId: world.schedulerId,
      checkedInAt: PAST_START,
      checkedOutAt: PAST_END,
      breakMinutes: 30,
      reason: 'The ward network was down for the whole shift; recorded from the paper log.',
    });

    expect(result.status).toBe('MANUALLY_CORRECTED');
    expect(result.checkedInAt?.toISOString()).toBe(PAST_START.toISOString());
    expect(result.breakMinutes).toBe(30);
  });

  it('refuses a manual record with no reason', async () => {
    const world = await buildWorld();

    await expect(
      recordManualAttendance({
        assignmentId: world.assignmentId,
        actorId: world.schedulerId,
        checkedInAt: SHIFT_START,
        checkedOutAt: SHIFT_END,
        reason: '   ',
      }),
    ).rejects.toThrow(/why this shift/);
  });

  it('keeps when it happened apart from when it was recorded', async () => {
    const world = await buildWorld();
    await recordManualAttendance({
      assignmentId: world.assignmentId,
      actorId: world.schedulerId,
      checkedInAt: PAST_START,
      checkedOutAt: PAST_END,
      reason: 'Network outage at the facility; times taken from the ward diary.',
    });

    const events = await listCheckInEvents(world.assignmentId);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.method).toBe('MANUAL');
      expect(event.reason).toContain('Network outage');
      // The whole difference with a manual record: it was recorded after the
      // fact, and the log says so.
      expect(event.recordedAt.getTime()).toBeGreaterThan(event.occurredAt.getTime());
    }
  });

  it('can correct a shift that was already checked in', async () => {
    const world = await buildWorld();
    await checkIn(world);

    // A facility whose network failed part-way through is exactly the case.
    const corrected = await recordManualAttendance({
      assignmentId: world.assignmentId,
      actorId: world.schedulerId,
      checkedInAt: PAST_START,
      checkedOutAt: PAST_END,
      reason: 'Network failed before check-out; end time taken from the ward diary.',
    });

    expect(corrected.status).toBe('MANUALLY_CORRECTED');
    const events = await listCheckInEvents(world.assignmentId);
    // The original token-backed check-in survives alongside the correction.
    expect(events.filter((event) => event.method === 'SUPERVISOR_CODE')).toHaveLength(1);
    expect(events.filter((event) => event.method === 'MANUAL')).toHaveLength(2);
  });

  it('refuses a check-out before the check-in', async () => {
    const world = await buildWorld();

    await expect(
      recordManualAttendance({
        assignmentId: world.assignmentId,
        actorId: world.schedulerId,
        checkedInAt: SHIFT_END,
        checkedOutAt: SHIFT_START,
        reason: 'Times transposed on the paper log, corrected here.',
      }),
    ).rejects.toThrow(/must end after/);
  });
});

describe('the state machine is the only way through', () => {
  it('audits every move with before and after', async () => {
    const world = await buildWorld();
    await checkIn(world);

    const audited = await prisma.auditLog.findMany({
      where: { action: 'attendance.checked_in' },
    });
    expect(audited).toHaveLength(1);
    expect(audited[0]?.before).toMatchObject({ status: 'CHECK_IN_PENDING' });
    expect(audited[0]?.after).toMatchObject({ status: 'CHECKED_IN' });
  });

  it('never writes a code into the audit trail', async () => {
    const world = await buildWorld();
    const token = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });

    // It is a live credential for the next five minutes.
    const audited = await prisma.auditLog.findMany({
      where: { action: 'attendance.token_issued' },
    });
    expect(JSON.stringify(audited)).not.toContain(token.code);
  });

  it('reports the record and its whole event log together', async () => {
    const world = await buildWorld();
    await checkIn(world);

    expect((await getAttendance(world.assignmentId)).status).toBe('CHECKED_IN');
    expect(await listCheckInEvents(world.assignmentId)).toHaveLength(1);
  });
});

describe('the route table', () => {
  it('issues at facility scope and presents at self scope', () => {
    const issue = ROUTES.find((route) => route.path.endsWith('/attendance/token'));
    const present = ROUTES.find((route) => route.path.endsWith('/attendance/present'));

    // The direction is what makes the token evidence of presence rather than
    // proof that somebody owns a phone.
    expect(issue?.scopeType).toBe('FACILITY');
    expect(present?.scopeType).toBe('SELF');
  });

  it('keeps the manual fallback with the facility', () => {
    const manual = ROUTES.find((route) => route.path.endsWith('/attendance/manual'));
    expect(manual?.scopeType).toBe('FACILITY');
    expect(manual?.permission).toBe('attendance.record');
  });
});
