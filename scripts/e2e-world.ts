/**
 * The world the browser journeys run in.
 *
 * `tests/e2e/global-setup.ts` runs this once before every Playwright run. It
 * wipes whatever the previous run left — everything it makes is tagged with
 * the `e2e.medilink.test` email domain and the `RC99` CAC prefix — and builds
 * a small, known starting point: a platform administrator, a verified
 * hospital with its owner and scheduler, a hospital waiting for verification,
 * a practitioner who is fully cleared to work, one who has only just signed
 * up, a scheduler who works at both hospitals, and three of the nurse's
 * shifts: one worked and approved yesterday, one nearly over and waiting to be
 * recorded, and one about to start.
 *
 * Everything is built through the application's own functions, the same as
 * `seed-demo.ts`, so a journey starts from state the product could actually
 * have produced. The only direct writes are user rows (registration needs a
 * one-time code a script cannot read) and moving one shift's times into the
 * past, which nothing else can do.
 *
 * It shares no phone number, CAC number or email domain with the demo seed or
 * the bootstrap, so running it leaves both of those worlds alone.
 *
 *   docker compose exec web pnpm tsx scripts/e2e-world.ts
 *
 * Writes `.e2e/world.json` and prints the same JSON.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/lib/db';
import { ROLE_PERMISSIONS } from '../src/lib/authz/permissions';
import { grantRole } from '../src/modules/auth/application/grants';
import { createFacility, verifyFacility } from '../src/modules/facilities/application/facility';
import { createProfile } from '../src/modules/practitioners/application/profile';
import { grantPractitionerRoleOnRegistration } from '../src/modules/practitioners/application/role-grants';
import {
  recordIdentityVerification,
  recordProfessionalRegistration,
} from '../src/modules/practitioners/application/verification';
import { screenPractitioner } from '../src/modules/practitioners/application/screening';
import {
  activateEligiblePractitioners,
  getEligibility,
} from '../src/modules/practitioners/application/eligibility';
import { reviewCredential, submitCredential } from '../src/modules/credentials/application/submission';
import { addSlot } from '../src/modules/availability/application/availability';
import {
  createServiceRequest,
  publishServiceRequest,
} from '../src/modules/service-requests/application/request';
import {
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '../src/modules/matching/application/assignment';
import { recordManualAttendance } from '../src/modules/attendance/application/attendance';
import {
  computeAndSaveTimesheet,
  reviewTimesheet,
  submitTimesheet,
} from '../src/modules/timesheets/application/timesheet';
import { clearWorld } from './support/clear-world';
import { DEMO_PASSWORD, assertLocal, demoPasswordHash, syncRoles } from './support/demo';

const EMAIL_DOMAIN = 'e2e.medilink.test';
const CAC_PREFIX = 'RC99';
/** `+23480399000NN`. The demo seed is on `…312000NN`, the bootstrap on `…311000NN`. */
const PHONE_PREFIX = '+23480399000';
const FCT = 'FC';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function phone(suffix: number): string {
  return `${PHONE_PREFIX}${String(suffix).padStart(2, '0')}`;
}

interface Person {
  id: string;
  fullName: string;
  phone: string;
}

/**
 * A signed-up user with a verified phone and a password — the row
 * registration leaves behind. Roles come from the application's own grant
 * paths, never from here.
 */
async function makeUser(
  fullName: string,
  suffix: number,
  status: 'ACTIVE' | 'UNDER_REVIEW',
): Promise<Person> {
  const user = await prisma.user.create({
    data: {
      fullName,
      phone: phone(suffix),
      status,
      passwordHash: await demoPasswordHash(),
      phoneVerifiedAt: new Date(),
      email: `${fullName.toLowerCase().replace(/[^a-z]+/g, '.')}@${EMAIL_DOMAIN}`,
    },
  });
  return { id: user.id, fullName, phone: user.phone };
}

/** Whole minutes, so a time typed into a datetime-local input round-trips. */
function floorToQuarterHour(at: Date): Date {
  const quarter = 15 * MINUTE;
  return new Date(Math.floor(at.getTime() / quarter) * quarter);
}

/**
 * How long the oldest unclaimed outbox event has been waiting, in seconds.
 *
 * Several journeys wait on the worker — the baseline practitioner grant after
 * signing up, the timesheet worked out after a shift is recorded — and a
 * stopped worker makes them fail as timeouts that say nothing about why.
 * Measured here so global setup can say it in one line instead.
 */
async function workerLagSeconds(): Promise<number> {
  const oldest = await prisma.outboxEvent.findFirst({
    where: { status: 'PENDING', availableAt: { lte: new Date() } },
    orderBy: { availableAt: 'asc' },
    select: { availableAt: true },
  });
  return oldest ? Math.round((Date.now() - oldest.availableAt.getTime()) / 1000) : 0;
}

async function main(): Promise<void> {
  assertLocal('e2e-world');

  await syncRoles(prisma);
  const cleared = await clearWorld(prisma, { emailDomain: EMAIL_DOMAIN, cacPrefix: CAC_PREFIX });

  const [nurse, generalHospital, clinic, fct, nin] = await Promise.all([
    prisma.professionalCategory.findUnique({ where: { key: 'nurse' } }),
    prisma.facilityType.findUnique({ where: { key: 'general_hospital' } }),
    prisma.facilityType.findUnique({ where: { key: 'clinic' } }),
    prisma.state.findFirst({ where: { code: FCT } }),
    prisma.credentialType.findUnique({ where: { key: 'nin_slip' } }),
  ]);
  if (!nurse || !generalHospital || !clinic || !fct || !nin) {
    throw new Error('Run `pnpm db:seed` first — the controlled vocabularies are empty.');
  }
  const abuja = await prisma.lga.findFirst({ where: { stateId: fct.id, name: 'Abuja Municipal' } });
  if (!abuja) throw new Error('No Abuja Municipal LGA. Run `pnpm db:seed` first.');

  // ------------------------------------------------------------ platform
  // The first administrator is the one account no grant path can create:
  // granting a PLATFORM role is exactly what a PLATFORM role is for.
  const root = await makeUser('Root Testadmin', 1, 'ACTIVE');
  const superRole = await prisma.role.findUniqueOrThrow({ where: { key: 'super_administrator' } });
  await prisma.userRole.create({
    data: { userId: root.id, roleId: superRole.id, scopeType: 'PLATFORM', scopeId: null },
  });

  const admin = await makeUser('Adaku Testadmin', 2, 'ACTIVE');
  await grantRole({
    userId: admin.id,
    roleKey: 'administrator',
    scopeType: 'PLATFORM',
    actorId: root.id,
    actorPermissions: ROLE_PERMISSIONS.super_administrator ?? [],
  });

  // ---------------------------------------------------------- facilities
  const owner = await makeUser('Obinna Testowner', 11, 'ACTIVE');
  const facility = await createFacility({
    name: 'E2E General Hospital',
    facilityTypeId: generalHospital.id,
    cacNumber: `${CAC_PREFIX}0001`,
    stateId: fct.id,
    lgaId: abuja.id,
    addressLine: '1 Journey Road, Garki, Abuja',
    contactPhone: owner.phone,
    representativeUserId: owner.id,
    actorId: admin.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: admin.id, decision: 'approve' });

  const scheduler = await makeUser('Sade Testscheduler', 12, 'ACTIVE');
  await grantRole({
    userId: scheduler.id,
    roleKey: 'facility_administrator',
    scopeType: 'FACILITY',
    scopeId: facility.id,
    actorId: owner.id,
    actorPermissions: ROLE_PERMISSIONS.facility_owner ?? [],
  });

  const pendingOwner = await makeUser('Peter Testpending', 13, 'ACTIVE');
  const pendingFacility = await createFacility({
    name: 'E2E Pending Clinic',
    facilityTypeId: clinic.id,
    cacNumber: `${CAC_PREFIX}0002`,
    stateId: fct.id,
    lgaId: abuja.id,
    addressLine: '2 Journey Road, Wuse, Abuja',
    contactPhone: pendingOwner.phone,
    representativeUserId: pendingOwner.id,
    actorId: admin.id,
  });
  // A facility in the queue has given its licence, and verifying it needs one on file (UXO-02).
  // Set directly: the journey is about the officer's checks, not about the upload.
  await prisma.facility.update({
    where: { id: pendingFacility.id },
    data: {
      licenceNumber: 'E2E/LIC/0002',
      licenceObjectKey: `facility-licence/${pendingFacility.id}/licence.pdf`,
    },
  });

  // -------------------------------------------------------- practitioners
  // Cleared to work: every blocker in practitioners/domain/eligibility.ts
  // answered, the way compliance answers them in the console.
  const nurseAda = await makeUser('Ada Testnurse', 21, 'UNDER_REVIEW');
  await grantPractitionerRoleOnRegistration(nurseAda.id);
  await createProfile({
    userId: nurseAda.id,
    professionalCategoryId: nurse.id,
    yearsOfExperience: 6,
    homeStateId: fct.id,
    homeLgaId: abuja.id,
    travelPreference: 'ANYWHERE',
  });
  for (let day = 0; day < 7; day += 1) {
    await addSlot({
      userId: nurseAda.id,
      kind: 'RECURRING_WEEKLY',
      dayOfWeek: day,
      startMinute: 0,
      endMinute: 1440,
    });
  }
  await recordIdentityVerification({
    userId: nurseAda.id,
    nin: '99000000021',
    nameMatch: true,
    actorId: admin.id,
  });
  await recordProfessionalRegistration({
    userId: nurseAda.id,
    regulator: nurse.regulator,
    folioNumber: 'RN/990021',
    registrationStatus: 'ACTIVE',
    practiceType: 'Registered practitioner',
    location: 'Abuja',
    expiresAt: new Date(Date.now() + 365 * 24 * HOUR),
    actorId: admin.id,
  });
  const ninSubmission = await submitCredential({
    userId: nurseAda.id,
    credentialTypeId: nin.id,
    referenceNumber: '99000000021',
  });
  await reviewCredential({ submissionId: ninSubmission.id, reviewerId: admin.id, decision: 'approve' });
  await screenPractitioner(nurseAda.id);
  // The hourly sweep's own function. It looks at everybody under review, so
  // it may activate somebody else's half-finished account too — which is what
  // it would have done within the hour anyway.
  await activateEligiblePractitioners();

  const eligibility = await getEligibility(nurseAda.id);
  if (!eligibility?.eligible) {
    throw new Error(`Ada Testnurse should be eligible and is not: ${JSON.stringify(eligibility)}`);
  }

  // Signed up, nothing else. The onboarding journey does the rest by hand.
  const newcomer = await makeUser('Bola Testnewcomer', 22, 'UNDER_REVIEW');
  await grantPractitionerRoleOnRegistration(newcomer.id);
  await screenPractitioner(newcomer.id);

  // ------------------------------------------------------------ the shifts
  /**
   * Books Ada onto a shift at E2E General: published, offered, accepted and
   * confirmed through the same functions the consoles call.
   *
   * A request cannot be published for a time that has passed, so a shift
   * meant to be in the past is booked three hours out and then moved — the
   * request and the assignment both, because confirmation copies the times
   * onto the assignment and the overlap check, the roster and the timesheet
   * all read that copy. Shifts are booked in time order, each moved out of
   * the next one's way before it is confirmed, or the overlap check refuses.
   */
  const nurseCategoryId = nurse.id;
  async function bookAda(input: {
    startsAt: Date;
    endsAt: Date;
    urgency?: 'ROUTINE' | 'URGENT';
    notes: string;
  }) {
    const inFuture = input.startsAt.getTime() > Date.now() + HOUR;
    const bookedFrom = inFuture ? input.startsAt : new Date(Date.now() + 3 * HOUR);
    const length = input.endsAt.getTime() - input.startsAt.getTime();
    const request = await createServiceRequest({
      facilityId: facility.id,
      professionalCategoryId: nurseCategoryId,
      shiftType: 'DAY',
      startsAt: bookedFrom,
      endsAt: new Date(bookedFrom.getTime() + length),
      headcount: 1,
      hourlyRateKobo: 500_000,
      urgency: input.urgency ?? 'ROUTINE',
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift without penalty.',
      notes: input.notes,
      actorId: scheduler.id,
    });
    await publishServiceRequest({ requestId: request.id, facilityId: facility.id, actorId: scheduler.id });
    const [invitation] = await invitePractitioners({
      requestId: request.id,
      facilityId: facility.id,
      userIds: [nurseAda.id],
      actorId: scheduler.id,
    });
    await respondToInvitation({ invitationId: invitation!.id, userId: nurseAda.id, decision: 'accept' });
    const assignment = await confirmAssignment({
      requestId: request.id,
      facilityId: facility.id,
      userId: nurseAda.id,
      actorId: scheduler.id,
    });
    if (!inFuture) {
      const moved = { startsAt: input.startsAt, endsAt: input.endsAt };
      await prisma.serviceRequest.update({ where: { id: request.id }, data: moved });
      await prisma.assignment.update({ where: { id: assignment.id }, data: moved });
    }
    return { assignmentId: assignment.id, startsAt: input.startsAt, endsAt: input.endsAt };
  }

  /**
   * Yesterday's shift, worked, recorded, submitted and approved — the money
   * journey's starting point: approved work nobody has invoiced yet.
   *
   * Attendance is recorded the moment it is moved into the past, so
   * `assignment.unhonoured_sweep` never sees a finished shift with nobody on it.
   */
  const yesterday = floorToQuarterHour(new Date(Date.now() - 32 * HOUR));
  const billable = await bookAda({
    startsAt: yesterday,
    endsAt: new Date(yesterday.getTime() + 8 * HOUR),
    notes: 'E2E: worked and approved, waiting to be invoiced.',
  });
  await recordManualAttendance({
    assignmentId: billable.assignmentId,
    actorId: scheduler.id,
    checkedInAt: billable.startsAt,
    checkedOutAt: billable.endsAt,
    breakMinutes: 0,
    reason: 'E2E world: recorded from the ward paper log.',
  });
  await computeAndSaveTimesheet(billable.assignmentId);
  await submitTimesheet({ assignmentId: billable.assignmentId, userId: nurseAda.id });
  await reviewTimesheet({
    assignmentId: billable.assignmentId,
    facilityId: facility.id,
    actorId: scheduler.id,
    decision: 'approve',
  });

  /**
   * A shift Ada has nearly finished, for the after-the-shift journey: started
   * eight hours ago, ends 15–30 minutes from now. Ending *after* now matters —
   * a confirmed shift that has ended with no attendance is exactly what the
   * unhonoured sweep looks for, and it finding this one before the journey
   * does would be a flaky test that was right.
   */
  const workedFrom = floorToQuarterHour(new Date(Date.now() - 8 * HOUR));
  const afterShift = await bookAda({
    startsAt: workedFrom,
    endsAt: new Date(workedFrom.getTime() + 8.5 * HOUR),
    notes: 'E2E: the shift the after-the-shift journey records by hand.',
  });

  /**
   * A shift about to start, for the attendance journey: the ward reads Ada a
   * code and she checks in with it. The next quarter-hour at least 45 minutes
   * out, which is after the shift above ends.
   */
  const liveFrom = floorToQuarterHour(new Date(Date.now() + HOUR));
  const liveShift = await bookAda({
    startsAt: liveFrom,
    endsAt: new Date(liveFrom.getTime() + 8 * HOUR),
    urgency: 'URGENT',
    notes: 'E2E: the shift the attendance journey checks in to.',
  });

  // ------------------------------------------------------- two hospitals
  // Somebody who works at both, for the facility switcher. Each owner adds
  // them, the way a hospital staffs itself.
  const multisite = await makeUser('Musa Testmultisite', 14, 'ACTIVE');
  for (const [site, granter] of [
    [facility.id, owner.id],
    [pendingFacility.id, pendingOwner.id],
  ] as const) {
    await grantRole({
      userId: multisite.id,
      roleKey: 'facility_administrator',
      scopeType: 'FACILITY',
      scopeId: site,
      actorId: granter,
      actorPermissions: ROLE_PERMISSIONS.facility_owner ?? [],
    });
  }

  const world = {
    builtAt: new Date().toISOString(),
    cleared,
    password: DEMO_PASSWORD,
    admin,
    owner,
    scheduler,
    pendingOwner,
    practitioner: nurseAda,
    newcomer,
    facility: { id: facility.id, name: facility.name },
    pendingFacility: { id: pendingFacility.id, name: pendingFacility.name },
    multisite,
    billableShift: {
      assignmentId: billable.assignmentId,
      startsAt: billable.startsAt.toISOString(),
      endsAt: billable.endsAt.toISOString(),
    },
    afterShift: {
      assignmentId: afterShift.assignmentId,
      startsAt: afterShift.startsAt.toISOString(),
      endsAt: afterShift.endsAt.toISOString(),
      hourlyRateKobo: 500_000,
    },
    liveShift: {
      assignmentId: liveShift.assignmentId,
      startsAt: liveShift.startsAt.toISOString(),
      endsAt: liveShift.endsAt.toISOString(),
    },
    workerLagSeconds: await workerLagSeconds(),
  };

  const dir = join(process.cwd(), '.e2e');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'world.json'), JSON.stringify(world, null, 2));
  console.log(JSON.stringify(world));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
