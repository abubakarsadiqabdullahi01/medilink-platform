import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import {
  createServiceRequest,
  publishServiceRequest,
} from '@/modules/service-requests/application/request';
import { createProfile } from '@/modules/practitioners/application/profile';
import {
  recordIdentityVerification,
  recordProfessionalRegistration,
} from '@/modules/practitioners/application/verification';
import { screenPractitioner } from '@/modules/practitioners/application/screening';
import {
  createCredentialType,
  createFacilityType,
  createProfessionalCategory,
  createState,
  createUser,
  ensureRole,
} from './fixtures';

/**
 * A verified facility, a published shift in the future, and practitioners who
 * clear every rule the platform has — the starting point for tests about what
 * happens when one of those things stops being true.
 *
 * Real eligibility, on purpose: a suite that stubs out "is this person still
 * bookable" cannot show that the question is asked.
 */

let sequence = 0;

export interface BookingWorld {
  facilityId: string;
  stateId: string;
  categoryId: string;
  credentialTypeId: string;
  requestId: string;
  schedulerId: string;
  startsAt: Date;
  endsAt: Date;
}

export async function buildBookingWorld(options: { headcount?: number } = {}): Promise<BookingWorld> {
  sequence += 1;
  // Registering a facility grants its representative the owner role.
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: 'Facility Representative' });
  const ops = await createUser({ fullName: 'Operations Officer' });
  const officer = await createUser({ fullName: 'Compliance Officer' });

  const facility = await createFacility({
    name: 'Owerri General Hospital',
    facilityTypeId: facilityType.id,
    cacNumber: `RC${800_000 + sequence}`,
    stateId: state.id,
    addressLine: '14 Wetheral Road, Owerri',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });

  const category = await createProfessionalCategory({ regulator: 'MDCN' });
  const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
  await prisma.credentialRequirement.create({
    data: {
      professionalCategoryId: category.id,
      credentialTypeId: credentialType.id,
      isMandatory: true,
      owner: 'test-fixture',
    },
  });

  const scheduler = await createUser({ fullName: 'Facility Scheduler' });
  const startsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);
  const request = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: category.id,
    shiftType: 'DAY',
    startsAt,
    endsAt,
    headcount: options.headcount ?? 1,
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

  return {
    facilityId: facility.id,
    stateId: state.id,
    categoryId: category.id,
    credentialTypeId: credentialType.id,
    requestId: request.id,
    schedulerId: scheduler.id,
    startsAt,
    endsAt,
  };
}

/** A practitioner who is eligible under the real rule: identity, registration, screening, credential. */
export async function eligiblePractitioner(
  world: Pick<BookingWorld, 'categoryId' | 'stateId' | 'credentialTypeId'>,
  fullName = 'Amina Yusuf',
) {
  sequence += 1;
  const user = await createUser({ fullName });
  const officer = await createUser({ fullName: 'Compliance Officer' });

  await createProfile({
    userId: user.id,
    professionalCategoryId: world.categoryId,
    yearsOfExperience: 5,
    homeStateId: world.stateId,
  });
  await recordIdentityVerification({
    userId: user.id,
    nin: String(20_000_000_000 + sequence),
    nameMatch: true,
    actorId: officer.id,
  });
  await recordProfessionalRegistration({
    userId: user.id,
    regulator: 'MDCN',
    folioNumber: `MDCN/B/${200_000 + sequence}`,
    registrationStatus: 'ACTIVE',
    actorId: officer.id,
  });
  await screenPractitioner(user.id);
  await prisma.credentialSubmission.create({
    data: {
      userId: user.id,
      credentialTypeId: world.credentialTypeId,
      status: 'VERIFIED',
      referenceNumber: 'A123456789',
    },
  });
  return user;
}

/** The regulator's register no longer shows them as active — a lapse between steps. */
export async function lapseRegistration(userId: string): Promise<void> {
  await prisma.professionalRegistration.updateMany({
    where: { userId },
    data: { registrationStatus: 'EXPIRED' },
  });
}
