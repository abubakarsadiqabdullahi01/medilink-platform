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
import { issueSession } from '@/modules/auth/application/session-service';
import { POST as presentRoute } from '@/app/api/v1/assignments/[id]/attendance/present/route';
import { POST as issueTokenRoute } from '@/app/api/v1/assignments/[id]/attendance/token/route';
import { POST as manualRoute } from '@/app/api/v1/assignments/[id]/attendance/manual/route';
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

/**
 * M09-03: what a code is good for. It proves presence at one shift, for one purpose, once, now.
 *
 * The digest binds the assignment and the purpose; the token is spent when used; and the time
 * that counts is the server's, never the caller's. Each of those was true and none was pinned
 * beside the others, so a change that loosened one would have passed.
 */
describe('what a code is good for (M09-03)', () => {
  /** A second confirmed shift for the same practitioner, at the same facility, three days on. */
  async function bookAnotherShift(world: World): Promise<string> {
    const category = await createProfessionalCategory();
    const later = new Date(SHIFT_START.getTime() + 3 * 24 * 60 * 60 * 1000);
    const request = await createServiceRequest({
      facilityId: world.facilityId,
      professionalCategoryId: category.id,
      shiftType: 'DAY',
      startsAt: later,
      endsAt: new Date(later.getTime() + 8 * 60 * 60 * 1000),
      headcount: 1,
      hourlyRateKobo: 500_000,
      urgency: 'ROUTINE',
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      actorId: world.schedulerId,
    });
    await publishServiceRequest({
      requestId: request.id,
      facilityId: world.facilityId,
      actorId: world.schedulerId,
    });
    const [invitation] = await invitePractitioners({
      requestId: request.id,
      facilityId: world.facilityId,
      userIds: [world.practitionerId],
      actorId: world.schedulerId,
    });
    await respondToInvitation({
      invitationId: invitation!.id,
      userId: world.practitionerId,
      decision: 'accept',
    });
    const assignment = await confirmAssignment({
      requestId: request.id,
      facilityId: world.facilityId,
      userId: world.practitionerId,
      actorId: world.schedulerId,
    });
    return assignment.id;
  }

  it("will not take the code of one of the practitioner's shifts as the code of another", async () => {
    const world = await buildWorld();
    const otherShift = await bookAnotherShift(world);
    const first = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });
    const second = await issueCheckInToken({
      assignmentId: otherShift,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });

    // The second shift's six digits, typed against the first shift: nothing there names the
    // other shift, so it is the digest that has to refuse it.
    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: second.code,
        userId: world.practitionerId,
      }),
    ).rejects.toMatchObject({ code: 'check_in_token_invalid' });
    const untouched = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { assignmentId: world.assignmentId },
    });
    expect(untouched.status).toBe('CHECK_IN_PENDING');

    // And each shift's own code still works for it.
    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: first.code,
        userId: world.practitionerId,
      }),
    ).resolves.toMatchObject({ status: 'CHECKED_IN' });
  });

  it('will not take a check-in code as the check-out code of the same shift', async () => {
    const world = await buildWorld();
    const inCode = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });
    await presentCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      code: inCode.code,
      userId: world.practitionerId,
    });
    await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_OUT',
      actorId: world.schedulerId,
    });

    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_OUT',
        code: inCode.code,
        userId: world.practitionerId,
      }),
    ).rejects.toMatchObject({ code: 'check_in_token_invalid' });
    expect((await getAttendance(world.assignmentId)).status).toBe('CHECKED_IN');
  });

  it('spends a code when it is used, so a second presentation cannot reuse it', async () => {
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

    // The state machine stops a second check-in first; what matters is that the token is
    // spent in its own right, which is what holds if a record is ever moved back.
    const spent = await prisma.checkInToken.findFirstOrThrow({
      where: { attendanceRecord: { assignmentId: world.assignmentId }, purpose: 'CHECK_IN' },
    });
    expect(spent.consumedAt).not.toBeNull();
  });

  it('counts the time on the server, whatever time the caller says it is', async () => {
    const world = await buildWorld();
    const token = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });
    await prisma.checkInToken.updateMany({ data: { expiresAt: new Date(Date.now() - 60_000) } });
    await grant({
      userId: world.practitionerId,
      roleKey: `practitioner_self_${world.practitionerId}`,
      permissions: ['attendance.record'],
      scopeType: 'SELF',
      scopeId: world.practitionerId,
    });
    await issueSession({ userId: world.practitionerId });

    // An expired code, with a claim that it is presented a quarter of an hour ago: before it
    // expired. The route does not read a time from the body, so the claim changes nothing.
    const claimed = new Date(Date.now() - 15 * 60_000).toISOString();
    const response = await presentRoute(
      new Request(`http://localhost/api/v1/assignments/${world.assignmentId}/attendance/present`, {
        method: 'POST',
        body: JSON.stringify({
          purpose: 'CHECK_IN',
          code: token.code,
          occurredAt: claimed,
          presentedAt: claimed,
          now: claimed,
        }),
      }),
      { params: Promise.resolve({ id: world.assignmentId }) },
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toMatch(/expired/);
    expect((await getAttendance(world.assignmentId)).status).toBe('CHECK_IN_PENDING');
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


describe('whose shift it is', () => {
  /**
   * The guard proves who is calling and which scope they hold. Neither says
   * the shift named in the path is theirs, and attendance is the record pay
   * is computed from.
   */
  async function post(
    route: (request: Request, props: { params: Promise<{ id: string }> }) => Promise<Response>,
    suffix: string,
    assignmentId: string,
    body: Record<string, unknown>,
  ) {
    const response = await route(
      new Request(`http://localhost/api/v1/assignments/${assignmentId}/attendance/${suffix}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: assignmentId }) },
    );
    return { status: response.status, body: await response.json() };
  }

  it('does not let one practitioner check in on another\'s shift', async () => {
    const world = await buildWorld();
    const colleague = await createUser({ fullName: 'Bisi Adeyemi' });
    const token = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });

    // The code is read out on the ward, so a colleague hears it too.
    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: token.code,
        userId: colleague.id,
      }),
    ).rejects.toMatchObject({ code: 'assignment_not_found', status: 404 });

    const record = await prisma.attendanceRecord.findUniqueOrThrow({
      where: { assignmentId: world.assignmentId },
    });
    expect(record.status).toBe('CHECK_IN_PENDING');
    // The code was not spent either: the real practitioner can still use it.
    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: token.code,
        userId: world.practitionerId,
      }),
    ).resolves.toMatchObject({ status: 'CHECKED_IN' });
  });

  it('refuses a check-in on a shift that has since been cancelled', async () => {
    const world = await buildWorld();
    const token = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });
    await prisma.assignment.update({
      where: { id: world.assignmentId },
      data: { status: 'CANCELLED' },
    });

    await expect(
      presentCheckInToken({
        assignmentId: world.assignmentId,
        purpose: 'CHECK_IN',
        code: token.code,
        userId: world.practitionerId,
      }),
    ).rejects.toMatchObject({ code: 'assignment_not_confirmed' });
  });

  it('refuses another practitioner over the route, with their own SELF scope', async () => {
    const world = await buildWorld();
    const colleague = await createUser({ fullName: 'Bisi Adeyemi' });
    await grant({
      userId: colleague.id,
      roleKey: `practitioner_self_${colleague.id}`,
      permissions: ['attendance.record'],
      scopeType: 'SELF',
      scopeId: colleague.id,
    });
    const token = await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });

    await issueSession({ userId: colleague.id });
    const result = await post(presentRoute, 'present', world.assignmentId, {
      purpose: 'CHECK_IN',
      code: token.code,
    });
    expect(result.status).toBe(404);
  });

  it('does not let a facility issue a code for another facility\'s shift', async () => {
    const mine = await buildWorld();
    const theirs = await buildWorld();

    await issueSession({ userId: mine.schedulerId });
    const refused = await post(issueTokenRoute, 'token', theirs.assignmentId, {
      facilityId: mine.facilityId,
      purpose: 'CHECK_IN',
    });
    expect(refused.status).toBe(404);
    expect(await prisma.checkInToken.count()).toBe(0);

    const own = await post(issueTokenRoute, 'token', mine.assignmentId, {
      facilityId: mine.facilityId,
      purpose: 'CHECK_IN',
    });
    expect(own.status).toBe(201);
  });

  it('does not let a facility write the hours of another facility\'s shift', async () => {
    const mine = await buildWorld();
    const theirs = await buildWorld();

    await issueSession({ userId: mine.schedulerId });
    const refused = await post(manualRoute, 'manual', theirs.assignmentId, {
      facilityId: mine.facilityId,
      checkedInAt: PAST_START.toISOString(),
      checkedOutAt: PAST_END.toISOString(),
      reason: 'The ward network was down for the whole shift; taken from the paper log.',
    });
    expect(refused.status).toBe(404);

    const record = await prisma.attendanceRecord.findUnique({
      where: { assignmentId: theirs.assignmentId },
    });
    expect(record?.status ?? null).not.toBe('MANUALLY_CORRECTED');

    const own = await post(manualRoute, 'manual', mine.assignmentId, {
      facilityId: mine.facilityId,
      checkedInAt: PAST_START.toISOString(),
      checkedOutAt: PAST_END.toISOString(),
      reason: 'The ward network was down for the whole shift; taken from the paper log.',
    });
    expect(own.status).toBe(200);
  });
});
