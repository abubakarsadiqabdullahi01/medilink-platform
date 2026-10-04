/**
 * Seed data — Stage 3, step 3.7.
 *
 * Every list below is a controlled vocabulary with a named owner. Seeding is
 * idempotent (upsert by natural key) so it can run on every deploy.
 *
 * The geography is complete: all 36 states, the FCT and all 774 LGAs, in
 * `data/nigeria.ts`, with the counts asserted here rather than trusted. The
 * holiday list is still partial — the moveable Islamic and Christian dates
 * are announced each year and cannot be hard-coded for the ones after this,
 * which is a real limitation rather than an omission.
 */
import { PrismaClient } from '@prisma/client';
import { syncRoles } from '../src/lib/authz/sync-roles';
import { JOB_DEFINITIONS } from '../src/worker/jobs';

const prisma = new PrismaClient();

const OWNER_COMPLIANCE = 'compliance-officer';
import { NIGERIA, TOTAL_LGAS, TOTAL_STATES } from './data/nigeria';

const OWNER_OPERATIONS = 'operations-officer';
const OWNER_FINANCE = 'finance-officer';

/**
 * The permission catalogue and the role bundles.
 *
 * One line, because the logic is shared with the two demo scripts — they used
 * to carry their own copies and undo this one. See src/lib/authz/sync-roles.
 */
async function seedPermissionsAndRoles() {
  await syncRoles(prisma);
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

  /**
   * Specialties, per category.
   *
   * Nursing had none, which made "Nurse / Midwife" a single undifferentiated
   * pool — so a theatre asking for a perioperative nurse and a labour ward
   * asking for a midwife were posting the same shift, and the matcher could
   * not tell a candidate who had done neither from one who had done both.
   * They are three distinct trainings under one regulator, which is exactly
   * what a specialty is for: the NMCN registration is shared, the competence
   * is not.
   *
   * Named as a nurse would describe themselves rather than as a ward would
   * describe the post, because the person picking from this list is the
   * practitioner filling in their own profile.
   */
  const specialtiesByCategory: Record<string, string[]> = {
    doctor: [
      'general_practice', 'internal_medicine', 'paediatrics', 'obstetrics_gynaecology',
      'general_surgery', 'anaesthesia', 'emergency_medicine', 'family_medicine',
      'radiology', 'pathology', 'psychiatry', 'ophthalmology',
    ],
    nurse: ['general_nursing', 'perioperative_nursing', 'midwifery'],
  };

  const names: Record<string, string> = {
    general_nursing: 'General Nursing',
    perioperative_nursing: 'Perioperative (Pre-op / Theatre) Nursing',
    midwifery: 'Midwifery',
  };

  for (const [categoryKey, keys] of Object.entries(specialtiesByCategory)) {
    const category = await prisma.professionalCategory.findUniqueOrThrow({
      where: { key: categoryKey },
    });

    for (const key of keys) {
      const name =
        names[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      await prisma.specialty.upsert({
        where: { key },
        update: { name, categoryId: category.id, owner: OWNER_COMPLIANCE },
        create: { key, name, categoryId: category.id, owner: OWNER_COMPLIANCE },
      });
    }
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
  /**
   * All 36 states, the Federal Capital Territory, and all 774 LGAs.
   *
   * Not cosmetic: the matcher scores proximity on a practitioner's home LGA
   * and excludes a shift outside what they said they would travel to, so a
   * short list quietly narrows the whole platform to the places in it. This
   * carried three states and fifteen LGAs from Stage 3 until somebody opened
   * the profile form and asked where the rest were.
   *
   * The counts are asserted rather than trusted. A hand-maintained list of
   * 774 names is exactly the kind of thing that loses one in a merge, and a
   * missing LGA is invisible until somebody cannot find their own.
   */
  const total = NIGERIA.reduce((count, state) => count + state.lgas.length, 0);
  if (NIGERIA.length !== TOTAL_STATES) {
    throw new Error(`Expected ${TOTAL_STATES} states, found ${NIGERIA.length}.`);
  }
  if (total !== TOTAL_LGAS) {
    throw new Error(`Expected ${TOTAL_LGAS} local government areas, found ${total}.`);
  }

  for (const { code, name, zone, lgas } of NIGERIA) {
    const state = await prisma.state.upsert({
      where: { code },
      update: { name, zone, owner: OWNER_OPERATIONS },
      create: { code, name, zone, owner: OWNER_OPERATIONS },
    });

    // createMany with skipDuplicates rather than 774 upserts: the seed runs
    // on every deploy and on every integration run, and the difference is
    // minutes.
    await prisma.lga.createMany({
      data: lgas.map((lgaName) => ({ stateId: state.id, name: lgaName })),
      skipDuplicates: true,
    });
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
