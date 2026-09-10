/**
 * Seed data — Stage 3, step 3.7.
 *
 * Every list below is a controlled vocabulary with a named owner. Seeding is
 * idempotent (upsert by natural key) so it can run on every deploy.
 *
 * The state/LGA and holiday lists here are deliberately partial: they are
 * shaped correctly and must be completed from an authoritative source before
 * the Stage 3 gate. The row-count assertion in the test suite is what proves
 * completion, not this file.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/lib/authz/permissions';
import { JOB_DEFINITIONS } from '../src/worker/jobs';

const prisma = new PrismaClient();

const OWNER_COMPLIANCE = 'compliance-officer';
const OWNER_OPERATIONS = 'operations-officer';
const OWNER_FINANCE = 'finance-officer';

async function seedPermissionsAndRoles() {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
  }

  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: { name: roleKey },
      create: { key: roleKey, name: roleKey },
    });

    for (const permissionKey of permissionKeys) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permissionKey } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}

async function seedCategoriesAndSpecialties() {
  const categories = [
    { key: 'doctor', name: 'Medical Doctor', regulator: 'MDCN' },
    { key: 'nurse', name: 'Nurse / Midwife', regulator: 'NMCN' },
    { key: 'pharmacist', name: 'Pharmacist', regulator: 'PCN' },
    { key: 'lab_scientist', name: 'Medical Laboratory Scientist', regulator: 'MLSCN' },
    { key: 'radiographer', name: 'Radiographer', regulator: 'RRBN' },
  ];

  for (const category of categories) {
    await prisma.professionalCategory.upsert({
      where: { key: category.key },
      update: { ...category, owner: OWNER_COMPLIANCE },
      create: { ...category, owner: OWNER_COMPLIANCE },
    });
  }

  const doctor = await prisma.professionalCategory.findUniqueOrThrow({ where: { key: 'doctor' } });
  const specialties = [
    'general_practice', 'internal_medicine', 'paediatrics', 'obstetrics_gynaecology',
    'general_surgery', 'anaesthesia', 'emergency_medicine', 'family_medicine',
    'radiology', 'pathology', 'psychiatry', 'ophthalmology',
  ];

  for (const key of specialties) {
    const name = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    await prisma.specialty.upsert({
      where: { key },
      update: { name, categoryId: doctor.id, owner: OWNER_COMPLIANCE },
      create: { key, name, categoryId: doctor.id, owner: OWNER_COMPLIANCE },
    });
  }
}

async function seedCredentialTypes() {
  const types = [
    { key: 'mdcn_practising_licence', name: 'MDCN Annual Practising Licence', issuer: 'MDCN', isMandatory: true, expires: true, reviewDays: 365, verificationMethod: 'mdcn_status_check' },
    { key: 'nin_slip', name: 'National Identification Number', issuer: 'NIMC', isMandatory: true, expires: false, reviewDays: 3650, verificationMethod: 'nimc_verification' },
    { key: 'mbbs_certificate', name: 'MBBS / Primary Qualification Certificate', issuer: 'University', isMandatory: true, expires: false, reviewDays: 3650, verificationMethod: 'document_review' },
    { key: 'nysc_certificate', name: 'NYSC Discharge or Exemption Certificate', issuer: 'NYSC', isMandatory: false, expires: false, reviewDays: 3650, verificationMethod: 'document_review' },
    { key: 'good_standing', name: 'Certificate of Good Standing', issuer: 'MDCN', isMandatory: false, expires: true, reviewDays: 365, verificationMethod: 'document_review' },
    { key: 'indemnity_cover', name: 'Professional Indemnity Cover', issuer: 'Insurer', isMandatory: false, expires: true, reviewDays: 365, verificationMethod: 'document_review' },
  ];

  for (const type of types) {
    await prisma.credentialType.upsert({
      where: { key: type.key },
      update: { ...type, owner: OWNER_COMPLIANCE },
      create: { ...type, owner: OWNER_COMPLIANCE },
    });
  }
}

/**
 * Step 5.8: which credentials each category actually requires. Partial in
 * the same way the state and LGA lists are — only the doctor category is
 * populated, matching the three types that used to carry the old, global
 * `CredentialType.isMandatory` flag. Nurse, pharmacist, lab scientist and
 * radiographer have no seeded requirements yet; each needs its own
 * regulator-specific credential types added first, which is compliance's
 * list to complete, not a default this file should guess at.
 */
async function seedCredentialRequirements() {
  const doctor = await prisma.professionalCategory.findUniqueOrThrow({ where: { key: 'doctor' } });
  const mandatoryForDoctor = ['mdcn_practising_licence', 'nin_slip', 'mbbs_certificate'];

  for (const key of mandatoryForDoctor) {
    const credentialType = await prisma.credentialType.findUniqueOrThrow({ where: { key } });
    await prisma.credentialRequirement.upsert({
      where: {
        professionalCategoryId_credentialTypeId: {
          professionalCategoryId: doctor.id,
          credentialTypeId: credentialType.id,
        },
      },
      update: { isMandatory: true, owner: OWNER_COMPLIANCE },
      create: {
        professionalCategoryId: doctor.id,
        credentialTypeId: credentialType.id,
        isMandatory: true,
        owner: OWNER_COMPLIANCE,
      },
    });
  }
}

/**
 * Scheduled jobs come from JOB_DEFINITIONS so the code and the rows cannot
 * drift. `enabled` and `nextRunAt` are deliberately not in `update`: an
 * operator who disables a misbehaving sweep must not have it switched back on
 * by the next deploy's seed run.
 */
/**
 * The sanctioned and quack lists (step 5.6). Deliberately empty.
 *
 * Owner: Compliance. The real lists are MDCN's to publish and compliance's to
 * transcribe; an invented one would be worse than none, because a screening
 * step that matches nothing real still reports "clear" and looks like it
 * worked. Add rows here, or through a compliance tool when one exists.
 */
async function seedSanctionedEntries() {
  const entries: {
    sourceList: 'MDCN_QUACK_LIST' | 'MDCN_SANCTIONS' | 'INTERNAL';
    fullName: string;
    normalisedName: string;
    folioNumber: string | null;
    reason: string;
    listedAt: Date;
  }[] = [];

  for (const entry of entries) {
    await prisma.sanctionedEntry.create({ data: { ...entry, owner: OWNER_COMPLIANCE } });
  }
}

async function seedScheduledJobs() {
  for (const job of JOB_DEFINITIONS) {
    await prisma.scheduledJob.upsert({
      where: { key: job.key },
      update: { description: job.description, intervalSeconds: job.intervalSeconds },
      create: {
        key: job.key,
        description: job.description,
        intervalSeconds: job.intervalSeconds,
      },
    });
  }
}

async function seedFacilityTypes() {
  const types = [
    { key: 'teaching_hospital', name: 'Teaching Hospital', regulator: 'FMoH' },
    { key: 'general_hospital', name: 'General Hospital', regulator: 'State MoH' },
    { key: 'private_hospital', name: 'Private Hospital', regulator: 'State MoH' },
    { key: 'primary_health_centre', name: 'Primary Health Centre', regulator: 'NPHCDA' },
    { key: 'clinic', name: 'Clinic', regulator: 'State MoH' },
    { key: 'diagnostic_laboratory', name: 'Diagnostic Laboratory', regulator: 'MLSCN' },
    { key: 'imaging_centre', name: 'Imaging Centre', regulator: 'State MoH' },
  ];

  for (const type of types) {
    await prisma.facilityType.upsert({
      where: { key: type.key },
      update: { ...type, owner: OWNER_OPERATIONS },
      create: { ...type, owner: OWNER_OPERATIONS },
    });
  }
}

async function seedStates() {
  // Partial by design — pilot state first. Complete all 36 + FCT and their
  // LGAs from an authoritative source before the Stage 3 gate.
  const states = [
    { code: 'IM', name: 'Imo', zone: 'South East', lgas: ['Owerri Municipal', 'Owerri North', 'Owerri West', 'Okigwe', 'Orlu', 'Mbaitoli', 'Ikeduru'] },
    { code: 'LA', name: 'Lagos', zone: 'South West', lgas: ['Ikeja', 'Eti-Osa', 'Surulere', 'Alimosho', 'Ikorodu'] },
    { code: 'FC', name: 'Federal Capital Territory', zone: 'North Central', lgas: ['Abuja Municipal', 'Bwari', 'Gwagwalada'] },
  ];

  for (const { code, name, zone, lgas } of states) {
    const state = await prisma.state.upsert({
      where: { code },
      update: { name, zone, owner: OWNER_OPERATIONS },
      create: { code, name, zone, owner: OWNER_OPERATIONS },
    });
    for (const lgaName of lgas) {
      await prisma.lga.upsert({
        where: { stateId_name: { stateId: state.id, name: lgaName } },
        update: {},
        create: { stateId: state.id, name: lgaName },
      });
    }
  }
}

async function seedHolidays() {
  const holidays = [
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-05-01', name: "Workers' Day" },
    { date: '2026-06-12', name: 'Democracy Day' },
    { date: '2026-10-01', name: 'Independence Day' },
    { date: '2026-12-25', name: 'Christmas Day' },
    { date: '2026-12-26', name: 'Boxing Day' },
  ];

  for (const holiday of holidays) {
    const date = new Date(holiday.date);
    await prisma.publicHoliday.upsert({
      where: { date_name: { date, name: holiday.name } },
      update: { year: date.getUTCFullYear(), owner: OWNER_OPERATIONS },
      create: { date, name: holiday.name, year: date.getUTCFullYear(), owner: OWNER_OPERATIONS },
    });
  }
}

async function seedRateFloors() {
  // Placeholder floors pending the signed revenue decision (step 3.1).
  const floors = [
    // '*' means "any specialty in this category" — a sentinel rather than NULL,
    // because a nullable column cannot participate in a compound unique key.
    { categoryKey: 'doctor', specialtyKey: '*', shiftType: 'day', minHourlyKobo: 500_000 },
    { categoryKey: 'doctor', specialtyKey: '*', shiftType: 'night', minHourlyKobo: 650_000 },
    { categoryKey: 'nurse', specialtyKey: '*', shiftType: 'day', minHourlyKobo: 250_000 },
    { categoryKey: 'nurse', specialtyKey: '*', shiftType: 'night', minHourlyKobo: 325_000 },
  ];

  const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
  for (const floor of floors) {
    await prisma.rateFloor.upsert({
      where: {
        categoryKey_specialtyKey_shiftType_effectiveFrom: {
          categoryKey: floor.categoryKey,
          specialtyKey: floor.specialtyKey,
          shiftType: floor.shiftType,
          effectiveFrom,
        },
      },
      update: { minHourlyKobo: floor.minHourlyKobo, owner: OWNER_FINANCE },
      create: { ...floor, effectiveFrom, owner: OWNER_FINANCE },
    });
  }
}

async function main() {
  await seedPermissionsAndRoles();
  await seedCategoriesAndSpecialties();
  await seedCredentialTypes();
  await seedCredentialRequirements();
  await seedFacilityTypes();
  await seedStates();
  await seedHolidays();
  await seedRateFloors();
  await seedSanctionedEntries();
  await seedScheduledJobs();

  const counts = {
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count(),
    categories: await prisma.professionalCategory.count(),
    specialties: await prisma.specialty.count(),
    credentialTypes: await prisma.credentialType.count(),
    credentialRequirements: await prisma.credentialRequirement.count(),
    facilityTypes: await prisma.facilityType.count(),
    states: await prisma.state.count(),
    lgas: await prisma.lga.count(),
    holidays: await prisma.publicHoliday.count(),
    rateFloors: await prisma.rateFloor.count(),
    sanctionedEntries: await prisma.sanctionedEntry.count(),
    scheduledJobs: await prisma.scheduledJob.count(),
  };
  console.log('seed complete', counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
