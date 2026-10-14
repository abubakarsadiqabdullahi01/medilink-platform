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
import { recordManualAttendance } from '@/modules/attendance/application/attendance';
import { reviewTimesheet, submitTimesheet } from '@/modules/timesheets/application/timesheet';
import {
  createFacilityType,
  createProfessionalCategory,
  createState,
  createUser,
  ensureRole,
  grant,
} from './fixtures';

/**
 * A shift worked, submitted and approved: the state a dispute starts from. The
 * practitioner, the facility's ward manager (who holds dispute.manage at the
 * facility), its scheduler, and an operations officer who adjudicates.
 *
 * The caller must have mocked `@/modules/practitioners/application/bookable`
 * with `./always-bookable`, as the dispute suites do.
 */
const WORKED_FROM = new Date('2026-09-09T07:00:00.000Z');
const WORKED_TO = new Date('2026-09-09T15:00:00.000Z');
const SHIFT_START = new Date(Date.now() + 2 * 60 * 60 * 1000);
const SHIFT_END = new Date(SHIFT_START.getTime() + 8 * 60 * 60 * 1000);

let sequence = 0;

export interface World {
  facilityId: string;
  schedulerId: string;
  reviewerId: string;
  officerId: string;
  practitionerId: string;
  assignmentId: string;
}

/** A shift worked, submitted and approved — the state a dispute starts from. */
export async function buildWorld(): Promise<World> {
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
export async function approved(world: World) {
  await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
  return reviewTimesheet({
    assignmentId: world.assignmentId,
    facilityId: world.facilityId,
    actorId: world.reviewerId,
    decision: 'approve',
  });
}

/** And to REJECTED, the other disputable state. */
export async function rejected(world: World) {
  await submitTimesheet({ assignmentId: world.assignmentId, userId: world.practitionerId });
  return reviewTimesheet({
    assignmentId: world.assignmentId,
    facilityId: world.facilityId,
    actorId: world.reviewerId,
    decision: 'reject',
    reviewNotes: 'The break was an hour, not nought; the ward log shows it.',
  });
}

