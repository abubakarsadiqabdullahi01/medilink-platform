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
import { issueCheckInToken } from '@/modules/attendance/application/attendance';
import {
  getDetermination,
  listAwaitingFault,
  recordFault,
  sweepUnhonouredAssignments,
} from '@/modules/cancellations-sanctions/application/fault';
import {
  decideExcusal,
  listExcusals,
  requestExcusal,
} from '@/modules/cancellations-sanctions/application/excusal';
import { ROUTES } from '@/modules/cancellations-sanctions/routes';
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
 * Steps 7.7 and 7.8 — an assignment nobody honoured, and who was answerable.
 *
 * The gate condition is that every unhonoured assignment carries a fault
 * decision, so what is asserted here is mostly what the code refuses to do:
 * close without a decision, accuse a practitioner who has been excused, or
 * lose the refusal that came before a grant.
 */

/** The shift is already over — that is the whole premise. */
const SHIFT_START = new Date(Date.now() - 12 * 60 * 60 * 1000);
const SHIFT_END = new Date(Date.now() - 4 * 60 * 60 * 1000);

let sequence = 0;

interface World {
  facilityId: string;
  schedulerId: string;
  officerId: string;
  practitionerId: string;
  assignmentId: string;
}

/** A confirmed assignment whose shift has come and gone with nothing recorded. */
async function buildWorld(): Promise<World> {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const verifier = await createUser({ fullName: 'Verifying Officer' });

  sequence += 1;
  const facility = await createFacility({
    name: 'Kano Specialist Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${900_000 + sequence}`,
    stateId: state.id,
    addressLine: '9 Zoo Road, Kano',
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

  // Fault is decided at PLATFORM scope, not by the facility whose shift it
  // was: a facility deciding whether its own practitioner was at fault for a
  // shift that facility failed to open is not a finding anyone should rely on.
  const officer = await createUser({ fullName: 'Compliance Officer' });
  await grant({
    userId: officer.id,
    roleKey: 'compliance_officer',
    permissions: ['sanction.apply'],
    scopeType: 'PLATFORM',
  });

  // Published with a future shift, because a request that starts in the past
  // cannot be published — then the assignment is moved back, which is the
  // only way a test can let four hours go by.
  const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const request = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: category.id,
    shiftType: 'DAY',
    startsAt: future,
    endsAt: new Date(future.getTime() + 8 * 60 * 60 * 1000),
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

  const practitioner = await createUser({ fullName: 'Fatima Bello' });
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

  await prisma.assignment.update({
    where: { id: assignment.id },
    data: { startsAt: SHIFT_START, endsAt: SHIFT_END },
  });

  return {
    facilityId: facility.id,
    schedulerId: scheduler.id,
    officerId: officer.id,
    practitionerId: practitioner.id,
    assignmentId: assignment.id,
  };
}

beforeEach(() => {
  clearCookies();
});

describe('the sweep (7.7)', () => {
  it('flags a shift that ended with nothing recorded', async () => {
    const world = await buildWorld();

    expect(await sweepUnhonouredAssignments()).toBeGreaterThanOrEqual(1);

    const flagged = await getDetermination(world.assignmentId);
    expect(flagged.status).toBe('AWAITING_DECISION');
    // It flags. It does not decide.
    expect(flagged.fault).toBeNull();
    expect(flagged.decidedBy).toBeNull();

    const assignment = await getAssignment(world.assignmentId);
    expect(assignment?.status).toBe('CONFIRMED');
  });

  it('does not flag a shift somebody turned up to', async () => {
    const world = await buildWorld();
    // A code was issued and the record left pending: nobody completed the
    // check-in, but somebody was there doing something. A sweep that accused
    // on a narrower test would be accusing on a network failure.
    await issueCheckInToken({
      assignmentId: world.assignmentId,
      purpose: 'CHECK_IN',
      actorId: world.schedulerId,
    });

    await sweepUnhonouredAssignments();

    await expect(getDetermination(world.assignmentId)).rejects.toThrow();
  });

  it('does not flag a shift that has not ended yet', async () => {
    const world = await buildWorld();
    await prisma.assignment.update({
      where: { id: world.assignmentId },
      data: { endsAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    await sweepUnhonouredAssignments();

    await expect(getDetermination(world.assignmentId)).rejects.toThrow();
  });

  it('writes one row however many times it runs', async () => {
    const world = await buildWorld();

    await sweepUnhonouredAssignments();
    await sweepUnhonouredAssignments();
    await sweepUnhonouredAssignments();

    const rows = await prisma.unhonouredAssignment.count({
      where: { assignmentId: world.assignmentId },
    });
    expect(rows).toBe(1);
  });

  it('puts it on the queue a person works through', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();

    const queue = await listAwaitingFault();
    expect(queue.map((row) => row.assignmentId)).toContain(world.assignmentId);
  });
});

describe('the fault decision (7.7)', () => {
  it('refuses to close without a fault value', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();

    // The gate condition, stated as a test: no unhonoured assignment reaches
    // a final state without somebody having decided whose fault it was.
    await expect(
      recordFault({
        assignmentId: world.assignmentId,
        actorId: world.officerId,
        fault: null,
        reason: 'Closing this without deciding anything.',
      }),
    ).rejects.toThrow(/fault_not_decided/);

    const still = await getDetermination(world.assignmentId);
    expect(still.status).toBe('AWAITING_DECISION');
    const assignment = await getAssignment(world.assignmentId);
    expect(assignment?.status).toBe('CONFIRMED');
  });

  it('refuses a reason too short to mean anything', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();

    await expect(
      recordFault({
        assignmentId: world.assignmentId,
        actorId: world.officerId,
        fault: 'PRACTITIONER',
        reason: 'no show',
      }),
    ).rejects.toThrow(/reason_missing/);
  });

  it('practitioner fault makes it a no-show and publishes the event', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();

    const closed = await recordFault({
      assignmentId: world.assignmentId,
      actorId: world.officerId,
      fault: 'PRACTITIONER',
      reason: 'Did not attend and did not answer the ward on the day.',
    });

    expect(closed.status).toBe('CLOSED');
    expect(closed.fault).toBe('PRACTITIONER');
    expect(closed.decidedBy).toBe(world.officerId);

    // NO_SHOW is the other state Stage 6 left unreachable.
    const assignment = await getAssignment(world.assignmentId);
    expect(assignment?.status).toBe('NO_SHOW');

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: EVENTS.NoShowRecorded, aggregateId: world.assignmentId },
    });
    expect(event).not.toBeNull();

    const outcomes = await assignmentOutcomes(world.practitionerId);
    expect(outcomes).toEqual({ completed: 0, noShow: 1 });
    expect(reliabilityFrom(outcomes)).toBe(0);
  });

  it('facility fault costs the practitioner nothing', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();

    await recordFault({
      assignmentId: world.assignmentId,
      actorId: world.officerId,
      fault: 'FACILITY',
      reason: 'The ward was closed on the day and nobody told the practitioner.',
    });

    const assignment = await getAssignment(world.assignmentId);
    expect(assignment?.status).toBe('CANCELLED');

    const outcomes = await assignmentOutcomes(world.practitionerId);
    expect(outcomes).toEqual({ completed: 0, noShow: 0 });
    // Nothing decided about this practitioner either way, so still unproven
    // rather than unreliable.
    expect(reliabilityFrom(outcomes)).toBeNull();
  });

  it('will not decide twice', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();
    await recordFault({
      assignmentId: world.assignmentId,
      actorId: world.officerId,
      fault: 'NEITHER',
      reason: 'Flooding closed the road; neither party could have prevented it.',
    });

    await expect(
      recordFault({
        assignmentId: world.assignmentId,
        actorId: world.officerId,
        fault: 'PRACTITIONER',
        reason: 'Trying to change the finding after the fact.',
      }),
    ).rejects.toThrow(/already_closed/);

    const assignment = await getAssignment(world.assignmentId);
    expect(assignment?.status).toBe('CANCELLED');
  });

  it('records the decision in the audit trail with its reason', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();
    const determination = await getDetermination(world.assignmentId);

    await recordFault({
      assignmentId: world.assignmentId,
      actorId: world.officerId,
      fault: 'PRACTITIONER',
      reason: 'Did not attend and did not answer the ward on the day.',
    });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'assignment.fault_recorded', entityId: determination.id },
    });
    expect(audit?.actorId).toBe(world.officerId);
    expect(audit?.reason).toContain('did not answer the ward');
  });
});

describe('excusals (7.8)', () => {
  it('a granted excusal carries no penalty', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();

    const requested = await requestExcusal({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
      reason: 'Admitted to hospital the night before; discharge summary attached.',
    });
    expect(requested.status).toBe('REQUESTED');

    await decideExcusal({
      excusalId: requested.id,
      actorId: world.officerId,
      decision: 'grant',
      notes: 'Discharge summary checked against the dates.',
    });

    // No penalty, in the data rather than in the intention: the assignment
    // never reaches NO_SHOW, so it never enters the no-show term.
    const assignment = await getAssignment(world.assignmentId);
    expect(assignment?.status).toBe('CANCELLED');

    const outcomes = await assignmentOutcomes(world.practitionerId);
    expect(outcomes).toEqual({ completed: 0, noShow: 0 });
    expect(reliabilityFrom(outcomes)).toBeNull();

    // And the determination is closed by a person's decision, so the gate
    // condition is satisfied rather than bypassed.
    const determination = await getDetermination(world.assignmentId);
    expect(determination.status).toBe('CLOSED');
    expect(determination.fault).toBe('NEITHER');
    expect(determination.decidedBy).toBe(world.officerId);
  });

  it('refuses practitioner fault once an excusal has been granted', async () => {
    const world = await buildWorld();
    const requested = await requestExcusal({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
      reason: 'Admitted to hospital the night before; discharge summary attached.',
    });
    await decideExcusal({
      excusalId: requested.id,
      actorId: world.officerId,
      decision: 'grant',
      notes: 'Discharge summary checked against the dates.',
    });

    // Granted before the sweep ran, so nothing closed automatically — and the
    // finding is still impossible.
    await sweepUnhonouredAssignments();

    await expect(
      recordFault({
        assignmentId: world.assignmentId,
        actorId: world.officerId,
        fault: 'PRACTITIONER',
        reason: 'Attempting to record a no-show against an excused absence.',
      }),
    ).rejects.toThrow(/excused_cannot_be_practitioner_fault/);
  });

  it('keeps a refusal on the record when a later request is granted', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();

    const first = await requestExcusal({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
      reason: 'I was unwell that morning and could not travel.',
    });
    await decideExcusal({
      excusalId: first.id,
      actorId: world.officerId,
      decision: 'refuse',
      notes: 'Nothing was submitted to support this and the ward was not told.',
    });

    const second = await requestExcusal({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
      reason: 'Attaching the discharge summary now that the hospital has issued it.',
    });
    await decideExcusal({
      excusalId: second.id,
      actorId: world.officerId,
      decision: 'grant',
      notes: 'Discharge summary checked against the dates.',
    });

    // Both outcomes retained. A table that only remembered the answer
    // somebody liked would make the history useless for the dispute it
    // exists to serve.
    const all = await listExcusals(world.assignmentId);
    expect(all.map((row) => row.status)).toEqual(['REFUSED', 'GRANTED']);
    expect(all[0]!.decisionNotes).toContain('Nothing was submitted');
    expect(all[0]!.reason).toContain('unwell that morning');
  });

  it('a refusal alone decides nothing about fault', async () => {
    const world = await buildWorld();
    await sweepUnhonouredAssignments();

    const requested = await requestExcusal({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
      reason: 'I was unwell that morning and could not travel.',
    });
    await decideExcusal({
      excusalId: requested.id,
      actorId: world.officerId,
      decision: 'refuse',
      notes: 'Nothing was submitted to support this and the ward was not told.',
    });

    // An excusal refused for being unpersuasive is not the same as an absence
    // proven to be the practitioner's fault. The officer still has to decide.
    const determination = await getDetermination(world.assignmentId);
    expect(determination.status).toBe('AWAITING_DECISION');
    const assignment = await getAssignment(world.assignmentId);
    expect(assignment?.status).toBe('CONFIRMED');
  });

  it('refuses a refusal with no reason, and will not decide twice', async () => {
    const world = await buildWorld();
    const requested = await requestExcusal({
      assignmentId: world.assignmentId,
      userId: world.practitionerId,
      reason: 'I was unwell that morning and could not travel.',
    });

    await expect(
      decideExcusal({
        excusalId: requested.id,
        actorId: world.officerId,
        decision: 'refuse',
      }),
    ).rejects.toThrow(/notes_missing/);

    await decideExcusal({
      excusalId: requested.id,
      actorId: world.officerId,
      decision: 'grant',
      notes: 'Accepted on the practitioner s own account.',
    });
    await expect(
      decideExcusal({
        excusalId: requested.id,
        actorId: world.officerId,
        decision: 'refuse',
        notes: 'Changing the answer after the fact.',
      }),
    ).rejects.toThrow(/already_decided/);
  });

  it('will not let one practitioner ask to be excused from another s shift', async () => {
    const world = await buildWorld();
    const other = await buildWorld();

    await expect(
      requestExcusal({
        assignmentId: world.assignmentId,
        userId: other.practitionerId,
        reason: 'A shift that has nothing to do with this practitioner.',
      }),
    ).rejects.toThrow();
  });
});

describe('the route table', () => {
  it('decides fault at PLATFORM scope and never at the facility s', () => {
    const fault = ROUTES.find((route) => route.path.endsWith('/fault'));
    expect(fault?.scopeType).toBe('PLATFORM');
    expect(fault?.permission).toBe('sanction.apply');

    for (const route of ROUTES) {
      expect(route.scopeType).not.toBe('FACILITY');
    }
  });

  it('keeps requesting an excusal with the practitioner', () => {
    const request = ROUTES.find(
      (route) => route.method === 'POST' && route.path.endsWith('/excusals'),
    );
    expect(request?.scopeType).toBe('SELF');
  });
});
