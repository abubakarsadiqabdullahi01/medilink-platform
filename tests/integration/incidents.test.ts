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
  beginIncidentReview,
  closeIncident,
  getIncident,
  listIncidents,
  listOpenIncidents,
  reportIncident,
} from '@/modules/clinical-incidents/application/incident';
import {
  currentSuspension,
  reinstateAccount,
  suspendAccount,
  suspensionHistory,
} from '@/modules/clinical-incidents/application/suspension';
import { ROUTES } from '@/modules/clinical-incidents/routes';
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
 * Module 15 — clinical incidents, and the suspension path that `user.suspend`
 * has had a permission for since Stage 4 with no code behind it.
 *
 * The assertion that matters most is the last one: a suspension has to make a
 * practitioner ineligible, or the module has no teeth.
 */

const OCCURRED = new Date(Date.now() - 6 * 60 * 60 * 1000);
const SUMMARY =
  'Wrong dose drawn up and caught by the second checker before it reached the patient.';
const CLOSURE = 'The drug cupboard labelling was the cause; relabelled and re-checked.';

let sequence = 0;

interface World {
  facilityId: string;
  reporterId: string;
  officerId: string;
  practitionerId: string;
  assignmentId: string;
}

async function buildWorld(): Promise<World> {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);

  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const verifier = await createUser({ fullName: 'Verifying Officer' });

  sequence += 1;
  const facility = await createFacility({
    name: 'Jos University Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${400_000 + sequence}`,
    stateId: state.id,
    addressLine: '1 Murtala Mohammed Way, Jos',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: verifier.id, decision: 'approve' });

  const category = await createProfessionalCategory();
  const reporter = await createUser({ fullName: 'Ward Sister' });
  await grant({
    userId: reporter.id,
    roleKey: 'facility_owner',
    permissions: [
      'service_request.publish',
      'assignment.confirm',
      'incident.report',
      'facility.read',
    ],
    scopeType: 'FACILITY',
    scopeId: facility.id,
  });

  // Compliance decides the outcome, at PLATFORM. A facility judging an
  // incident that reflects on its own staffing is not a finding anyone should
  // rely on.
  const officer = await createUser({ fullName: 'Clinical Safety Lead' });
  await grant({
    userId: officer.id,
    roleKey: 'compliance_officer',
    permissions: ['incident.manage'],
    scopeType: 'PLATFORM',
  });

  const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const request = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: category.id,
    shiftType: 'NIGHT',
    startsAt: future,
    endsAt: new Date(future.getTime() + 8 * 60 * 60 * 1000),
    headcount: 1,
    hourlyRateKobo: 500_000,
    urgency: 'ROUTINE',
    cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
    actorId: reporter.id,
  });
  await publishServiceRequest({
    requestId: request.id,
    facilityId: facility.id,
    actorId: reporter.id,
  });

  const practitioner = await createUser({ fullName: 'Tunde Adeyemi' });
  const [invitation] = await invitePractitioners({
    requestId: request.id,
    facilityId: facility.id,
    userIds: [practitioner.id],
    actorId: reporter.id,
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
    actorId: reporter.id,
  });

  return {
    facilityId: facility.id,
    reporterId: reporter.id,
    officerId: officer.id,
    practitionerId: practitioner.id,
    assignmentId: assignment.id,
  };
}

beforeEach(() => {
  clearCookies();
});

describe('reporting', () => {
  it('files a report against a shift and takes the practitioner from it', async () => {
    const world = await buildWorld();

    const incident = await reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      assignmentId: world.assignmentId,
      occurredAt: OCCURRED,
      severity: 'NEAR_MISS',
      category: 'MEDICATION',
      summary: SUMMARY,
    });

    expect(incident.status).toBe('REPORTED');
    // The shift names the practitioner, so a report that gives one need not.
    expect(incident.subjectUserId).toBe(world.practitionerId);
    expect(incident.outcome).toBeNull();
  });

  it('accepts one tied to no shift and naming nobody', async () => {
    const world = await buildWorld();

    // An incident found during a case note review a week later, in a shared
    // drug cupboard. Refusing it because the paperwork is untidy loses the
    // report, and the report is the point.
    const incident = await reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      occurredAt: OCCURRED,
      severity: 'MODERATE',
      category: 'STAFFING',
      summary: 'Night shift ran two staff short for six hours; no single shift at fault.',
    });

    expect(incident.assignmentId).toBeNull();
    expect(incident.subjectUserId).toBeNull();
    expect(incident.status).toBe('REPORTED');
  });

  it('will not name a practitioner who has never worked at the facility', async () => {
    // A report can lead to a suspension. Without this check any facility could
    // file one against any practitioner on the platform by pasting their id.
    const world = await buildWorld();
    const stranger = await createUser({ fullName: 'Chidi Okeke' });

    await expect(
      reportIncident({
        facilityId: world.facilityId,
        actorId: world.reporterId,
        subjectUserId: stranger.id,
        occurredAt: OCCURRED,
        severity: 'MODERATE',
        category: 'CONDUCT',
        summary: SUMMARY,
      }),
    ).rejects.toMatchObject({ code: 'incident_subject_unknown', status: 422 });
    expect(await prisma.clinicalIncident.count()).toBe(0);
  });

  it('accepts somebody who has worked there, with no shift named', async () => {
    const world = await buildWorld();

    const incident = await reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      subjectUserId: world.practitionerId,
      occurredAt: OCCURRED,
      severity: 'MINOR',
      category: 'DOCUMENTATION',
      summary: SUMMARY,
    });
    expect(incident.subjectUserId).toBe(world.practitionerId);
  });

  it('does not count a booking that was cancelled as having worked there', async () => {
    const world = await buildWorld();
    await prisma.assignment.update({
      where: { id: world.assignmentId },
      data: { status: 'CANCELLED' },
    });

    await expect(
      reportIncident({
        facilityId: world.facilityId,
        actorId: world.reporterId,
        subjectUserId: world.practitionerId,
        occurredAt: OCCURRED,
        severity: 'MINOR',
        category: 'DOCUMENTATION',
        summary: SUMMARY,
      }),
    ).rejects.toMatchObject({ code: 'incident_subject_unknown' });
  });

  it('refuses a subject who is not the practitioner on the shift named', async () => {
    // The shift is the evidence; a report that says "this shift" and "that
    // person" must not be able to pair a shift with somebody who was not on it.
    const world = await buildWorld();
    const other = await createUser({ fullName: 'Chidi Okeke' });

    await expect(
      reportIncident({
        facilityId: world.facilityId,
        actorId: world.reporterId,
        assignmentId: world.assignmentId,
        subjectUserId: other.id,
        occurredAt: OCCURRED,
        severity: 'MODERATE',
        category: 'CONDUCT',
        summary: SUMMARY,
      }),
    ).rejects.toMatchObject({ code: 'incident_subject_mismatch', status: 422 });
  });

  it('publishes the event and writes an audit row', async () => {
    const world = await buildWorld();
    const incident = await reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      occurredAt: OCCURRED,
      severity: 'MINOR',
      category: 'DOCUMENTATION',
      summary: SUMMARY,
    });

    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: EVENTS.ClinicalIncidentReported, aggregateId: incident.id },
    });
    expect(event).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'incident.reported', entityId: incident.id },
    });
    expect(audit?.actorId).toBe(world.reporterId);
  });

  it('refuses a report against another facility s shift', async () => {
    const world = await buildWorld();
    const other = await buildWorld();

    await expect(
      reportIncident({
        facilityId: other.facilityId,
        actorId: other.reporterId,
        assignmentId: world.assignmentId,
        occurredAt: OCCURRED,
        severity: 'MINOR',
        category: 'CONDUCT',
        summary: SUMMARY,
      }),
    ).rejects.toThrow();
  });

  it('refuses one that has not happened yet', async () => {
    const world = await buildWorld();

    await expect(
      reportIncident({
        facilityId: world.facilityId,
        actorId: world.reporterId,
        occurredAt: new Date(Date.now() + 60 * 60 * 1000),
        severity: 'MINOR',
        category: 'OTHER',
        summary: SUMMARY,
      }),
    ).rejects.toThrow(/occurred_in_the_future/);
  });

  it('shows on the facility s own list and on the compliance queue', async () => {
    const world = await buildWorld();
    const incident = await reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      occurredAt: OCCURRED,
      severity: 'MINOR',
      category: 'EQUIPMENT',
      summary: SUMMARY,
    });

    const facilityList = await listIncidents({ facilityId: world.facilityId, limit: 20 });
    expect(facilityList.incidents.map((r) => r.id)).toContain(incident.id);
    expect((await listOpenIncidents()).map((r) => r.id)).toContain(incident.id);
  });

  it("does not show one facility's reports on another's list, and reads every status by default", async () => {
    const mine = await buildWorld();
    const theirs = await buildWorld();

    const own = await reportIncident({
      facilityId: mine.facilityId,
      actorId: mine.reporterId,
      occurredAt: OCCURRED,
      severity: 'MINOR',
      category: 'EQUIPMENT',
      summary: SUMMARY,
    });
    await reportIncident({
      facilityId: theirs.facilityId,
      actorId: theirs.reporterId,
      occurredAt: OCCURRED,
      severity: 'MINOR',
      category: 'EQUIPMENT',
      summary: SUMMARY,
    });

    await beginIncidentReview({ incidentId: own.id, actorId: mine.officerId });
    await closeIncident({
      incidentId: own.id,
      actorId: mine.officerId,
      outcome: 'NO_ACTION',
      notes: 'Nothing further to do.',
    });

    // No status filter at all — a facility's own history is everything it
    // has filed, closed cases included, not the compliance queue's "open"
    // default.
    const list = await listIncidents({ facilityId: mine.facilityId, limit: 20 });
    expect(list.incidents.map((r) => r.id)).toEqual([own.id]);
    expect(list.incidents[0]?.status).toBe('CLOSED');
  });

  it('puts the most serious at the top of the queue', async () => {
    const world = await buildWorld();
    await reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      occurredAt: OCCURRED,
      severity: 'NEAR_MISS',
      category: 'MEDICATION',
      summary: SUMMARY,
    });
    const severe = await reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      occurredAt: OCCURRED,
      severity: 'SEVERE',
      category: 'CLINICAL_PROCEDURE',
      summary: 'Patient came to harm during a procedure carried out without a second checker.',
    });

    const queue = await listOpenIncidents();
    expect(queue[0]!.id).toBe(severe.id);
  });
});

describe('closing', () => {
  async function reported(world: World, severity: 'NEAR_MISS' | 'SEVERE' = 'NEAR_MISS') {
    return reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      assignmentId: world.assignmentId,
      occurredAt: OCCURRED,
      severity,
      category: 'MEDICATION',
      summary: SUMMARY,
    });
  }

  it('closes a near miss as a system issue, with nobody suspended', async () => {
    const world = await buildWorld();
    const incident = await reported(world);

    const closed = await closeIncident({
      incidentId: incident.id,
      actorId: world.officerId,
      outcome: 'SYSTEM_ISSUE',
      notes: CLOSURE,
    });

    expect(closed.status).toBe('CLOSED');
    expect(closed.outcome).toBe('SYSTEM_ISSUE');

    // The commonest true answer, and the one a blame-first process never
    // reaches. Nobody is suspended by it.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: world.practitionerId } });
    expect(user.status).not.toBe('SUSPENDED');
    expect(await currentSuspension(world.practitionerId)).toBeNull();
  });

  it('refuses a closure with no outcome or no reason', async () => {
    const world = await buildWorld();
    const incident = await reported(world);

    await expect(
      closeIncident({
        incidentId: incident.id,
        actorId: world.officerId,
        outcome: null,
        notes: CLOSURE,
      }),
    ).rejects.toThrow(/outcome_missing/);

    await expect(
      closeIncident({
        incidentId: incident.id,
        actorId: world.officerId,
        outcome: 'NO_ACTION',
        notes: 'fine',
      }),
    ).rejects.toThrow(/notes_missing/);
  });

  it('will not let a severe incident be closed without anybody opening it', async () => {
    const world = await buildWorld();
    const incident = await reported(world, 'SEVERE');

    await expect(
      closeIncident({
        incidentId: incident.id,
        actorId: world.officerId,
        outcome: 'NO_ACTION',
        notes: CLOSURE,
      }),
    ).rejects.toThrow(/not_reviewed/);

    await beginIncidentReview({ incidentId: incident.id, actorId: world.officerId });
    const closed = await closeIncident({
      incidentId: incident.id,
      actorId: world.officerId,
      outcome: 'ADVICE_GIVEN',
      notes: CLOSURE,
    });
    expect(closed.status).toBe('CLOSED');
  });

  it('will not close twice', async () => {
    const world = await buildWorld();
    const incident = await reported(world);
    await closeIncident({
      incidentId: incident.id,
      actorId: world.officerId,
      outcome: 'NO_ACTION',
      notes: CLOSURE,
    });

    await expect(
      closeIncident({
        incidentId: incident.id,
        actorId: world.officerId,
        outcome: 'PRACTITIONER_SUSPENDED',
        notes: CLOSURE,
      }),
    ).rejects.toThrow(/already_closed/);
  });

  it('refuses to suspend when the report names nobody', async () => {
    const world = await buildWorld();
    const incident = await reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      occurredAt: OCCURRED,
      severity: 'MODERATE',
      category: 'STAFFING',
      summary: 'Night shift ran two staff short for six hours; no single shift at fault.',
    });

    await expect(
      closeIncident({
        incidentId: incident.id,
        actorId: world.officerId,
        outcome: 'PRACTITIONER_SUSPENDED',
        notes: CLOSURE,
      }),
    ).rejects.toMatchObject({ code: 'incident_no_subject' });
  });

  it('leaves the report readable exactly as it was filed', async () => {
    const world = await buildWorld();
    const incident = await reported(world);
    await closeIncident({
      incidentId: incident.id,
      actorId: world.officerId,
      outcome: 'SYSTEM_ISSUE',
      notes: CLOSURE,
    });

    // Nothing edits or deletes a report. The value of the log is that it
    // holds what people said at the time.
    const read = await getIncident(incident.id);
    expect(read.summary).toBe(SUMMARY);
    expect(read.reportedBy).toBe(world.reporterId);
    expect(read.closureNotes).toBe(CLOSURE);
  });
});

describe('suspension, and whether it has teeth', () => {
  async function severeReport(world: World) {
    const incident = await reportIncident({
      facilityId: world.facilityId,
      actorId: world.reporterId,
      assignmentId: world.assignmentId,
      occurredAt: OCCURRED,
      severity: 'SEVERE',
      category: 'CLINICAL_PROCEDURE',
      summary: 'Patient came to harm during a procedure carried out without a second checker.',
    });
    await beginIncidentReview({ incidentId: incident.id, actorId: world.officerId });
    return incident;
  }

  const SUSPEND_NOTE =
    'Second checker was not used and the patient was harmed; off the register pending review.';

  it('suspends in the same transaction as the closure that ordered it', async () => {
    const world = await buildWorld();
    const incident = await severeReport(world);

    const closed = await closeIncident({
      incidentId: incident.id,
      actorId: world.officerId,
      outcome: 'PRACTITIONER_SUSPENDED',
      notes: SUSPEND_NOTE,
    });
    expect(closed.outcome).toBe('PRACTITIONER_SUSPENDED');

    // A closure claiming a suspension that did not happen would be a record
    // that lies. The two are written together or not at all.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: world.practitionerId } });
    expect(user.status).toBe('SUSPENDED');

    const suspension = await currentSuspension(world.practitionerId);
    expect(suspension?.incidentId).toBe(incident.id);
    expect(suspension?.suspendedBy).toBe(world.officerId);
    expect(suspension?.reason).toContain('Second checker');
  });

  it('makes the practitioner ineligible, which is the whole point', async () => {
    const world = await buildWorld();
    const { getEligibility } = await import('@/modules/practitioners/application/eligibility');

    const incident = await severeReport(world);
    await closeIncident({
      incidentId: incident.id,
      actorId: world.officerId,
      outcome: 'PRACTITIONER_SUSPENDED',
      notes: SUSPEND_NOTE,
    });

    // No sweep, no delay. SUSPENDED fails the account_not_usable check in the
    // Stage 5 eligibility rule, so the practitioner stops matching the moment
    // the closure is written.
    const eligibility = await getEligibility(world.practitionerId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.blockers).toContain('account_not_usable');
  });

  it('reinstates with its own reason, and the practitioner can match again', async () => {
    const world = await buildWorld();
    const { getEligibility } = await import('@/modules/practitioners/application/eligibility');
    const incident = await severeReport(world);
    await closeIncident({
      incidentId: incident.id,
      actorId: world.officerId,
      outcome: 'PRACTITIONER_SUSPENDED',
      notes: SUSPEND_NOTE,
    });

    await reinstateAccount({
      userId: world.practitionerId,
      actorId: world.officerId,
      reason: 'Retraining completed and signed off by the clinical safety lead.',
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: world.practitionerId } });
    expect(user.status).toBe('ACTIVE');
    expect(await currentSuspension(world.practitionerId)).toBeNull();

    const eligibility = await getEligibility(world.practitionerId);
    expect(eligibility.blockers).not.toContain('account_not_usable');
  });
});

describe('the suspension record', () => {
  const IMPOSED = 'Suspended pending an investigation into a medication error.';
  const LIFTED = 'Investigation found no fault on the part of the practitioner.';

  it('keeps the lifted suspension in the history', async () => {
    const world = await buildWorld();
    await suspendAccount({
      userId: world.practitionerId,
      actorId: world.officerId,
      reason: IMPOSED,
    });
    await reinstateAccount({
      userId: world.practitionerId,
      actorId: world.officerId,
      reason: LIFTED,
    });

    // A history that only showed the current suspension would hide the
    // pattern that matters most.
    const history = await suspensionHistory(world.practitionerId);
    expect(history).toHaveLength(1);
    expect(history[0]!.liftedBy).toBe(world.officerId);
    expect(history[0]!.liftedReason).toContain('no fault');
    expect(history[0]!.reason).toContain('medication error');
  });

  it('refuses a suspension or a reinstatement with no reason', async () => {
    const world = await buildWorld();

    await expect(
      suspendAccount({ userId: world.practitionerId, actorId: world.officerId, reason: 'bad' }),
    ).rejects.toMatchObject({ code: 'suspension_reason_required' });

    await suspendAccount({
      userId: world.practitionerId,
      actorId: world.officerId,
      reason: IMPOSED,
    });

    await expect(
      reinstateAccount({ userId: world.practitionerId, actorId: world.officerId, reason: 'ok' }),
    ).rejects.toMatchObject({ code: 'suspension_reason_required' });
  });

  it('will not suspend twice, or reinstate somebody who is not suspended', async () => {
    const world = await buildWorld();

    await expect(
      reinstateAccount({
        userId: world.practitionerId,
        actorId: world.officerId,
        reason: 'Nothing to lift here, because nothing was ever imposed.',
      }),
    ).rejects.toMatchObject({ code: 'not_suspended' });

    await suspendAccount({
      userId: world.practitionerId,
      actorId: world.officerId,
      reason: IMPOSED,
    });

    await expect(
      suspendAccount({
        userId: world.practitionerId,
        actorId: world.officerId,
        reason: 'A second suspension on top of one already in force.',
      }),
    ).rejects.toMatchObject({ code: 'already_suspended' });
  });

  it('records both the suspension and the reinstatement in the audit trail', async () => {
    const world = await buildWorld();
    await suspendAccount({
      userId: world.practitionerId,
      actorId: world.officerId,
      reason: IMPOSED,
    });
    await reinstateAccount({
      userId: world.practitionerId,
      actorId: world.officerId,
      reason: LIFTED,
    });

    for (const action of ['user.suspended', 'user.reinstated']) {
      const row = await prisma.auditLog.findFirst({
        where: { action, entityId: world.practitionerId },
      });
      expect(row?.actorId, action).toBe(world.officerId);
    }
  });
});

describe('the route table', () => {
  it('reports at FACILITY and decides at PLATFORM', () => {
    for (const route of ROUTES) {
      if (route.permission === 'incident.report') expect(route.scopeType).toBe('FACILITY');
      if (route.permission === 'incident.manage') expect(route.scopeType).toBe('PLATFORM');
    }
  });

  it('offers no way to delete or edit a report', () => {
    // A report that can be withdrawn is one a facility can be pressured into
    // withdrawing.
    expect(ROUTES.some((route) => route.method === 'DELETE')).toBe(false);
    expect(ROUTES.some((route) => route.method === 'PATCH')).toBe(false);
  });
});
