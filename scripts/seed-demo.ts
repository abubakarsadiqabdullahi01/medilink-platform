/**
 * A working hospital, simulated end to end — built the way the product builds it.
 *
 * One flagship facility, Aso Garden Specialist Hospital in Abuja, exercises
 * every feature the product has: shifts matched, offered, declined, confirmed,
 * checked in with codes and QR, worked, corrected, approved, disputed,
 * invoiced, paid and settled; no-shows swept up and decided; incidents
 * reported, reviewed and closed, one of them with a suspension; a rate card
 * superseded mid-year; staff granted by the owner. Around it sit what a real
 * platform has: two smaller verified hospitals to compare against, one
 * facility awaiting verification and one refused, and practitioners at every
 * stage of onboarding — including the ones who are stuck, because "why am I
 * not being offered work" is a question the product exists to answer.
 *
 * Every role in ROLE_PERMISSIONS has an account with a fixed phone number and
 * one shared password, so any screen can be tested as the person it is for.
 *
 * Every record goes through the application layer — not raw inserts — so what
 * comes out is genuinely consistent: audit rows exist because the code that
 * writes them ran, the outbox has events because something published them,
 * and the ledger balances because `assertBalanced` refused anything that did
 * not. A seed of straight `prisma.create` calls would produce a database that
 * looks right and is not, and the first thing it would hide is a missing
 * audit row.
 *
 * The one thing edited directly is *when*, never *what*. Publishing refuses a
 * shift that has already started — correctly — so history is created as real
 * future work, taken through the flow, and then moved to where it belongs.
 * The audit trail is not moved: it records when this script actually ran.
 *
 * Local only: it creates accounts with a known password.
 *
 *   docker compose exec web pnpm db:seed
 *   docker compose exec web pnpm tsx scripts/seed-demo.ts
 *
 * Re-runnable. It clears what it made first, so you get the same picture
 * rather than duplicates.
 */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { prisma } from '../src/lib/db';
import { env } from '../src/lib/env';
import { lagosDate } from '../src/lib/lagos-date';
import { s3 } from '../src/lib/storage/tigris';
import { ROLE_PERMISSIONS } from '../src/lib/authz/permissions';

import { grantRole } from '../src/modules/auth/application/grants';
import {
  createFacility,
  requestLicenceUploadUrl,
  updateFacility,
  verifyFacility,
} from '../src/modules/facilities/application/facility';
import { createProfile } from '../src/modules/practitioners/application/profile';
import { submitForReview } from '../src/modules/practitioners/application/application-review';
import { grantPractitionerRoleOnRegistration } from '../src/modules/practitioners/application/role-grants';
import {
  recordIdentityVerification,
  recordProfessionalRegistration,
} from '../src/modules/practitioners/application/verification';
import {
  clearScreeningFlag,
  screenPractitioner,
} from '../src/modules/practitioners/application/screening';
import {
  activateEligiblePractitioners,
  getEligibility,
} from '../src/modules/practitioners/application/eligibility';
import { expireRegistrations } from '../src/modules/practitioners/application/expiry';
import { normaliseName } from '../src/modules/practitioners/domain/screening';
import {
  requestDocumentUploadUrl,
  reviewCredential,
  submitCredential,
} from '../src/modules/credentials/application/submission';
import { expireCredentials } from '../src/modules/credentials/application/expiry';
import {
  addBlock,
  addSlot,
  availabilityForWindow,
} from '../src/modules/availability/application/availability';
import {
  cancelServiceRequest,
  createServiceRequest,
  publishServiceRequest,
} from '../src/modules/service-requests/application/request';
import { expireStartedRequests } from '../src/modules/service-requests/application/expiry';
import { runMatch } from '../src/modules/matching/application/match';
import {
  cancelAssignment,
  confirmAssignment,
  invitePractitioners,
  respondToInvitation,
} from '../src/modules/matching/application/assignment';
import {
  issueCheckInToken,
  presentCheckInToken,
  recordManualAttendance,
} from '../src/modules/attendance/application/attendance';
import {
  correctTimesheet,
  reviewTimesheet,
  submitTimesheet,
} from '../src/modules/timesheets/application/timesheet';
import { createRateCard, rateTermsFor } from '../src/modules/rates-contracts/application/rate-card';
import {
  generateInvoice,
  issueInvoice,
  recordPayment,
} from '../src/modules/billing-settlement/application/invoice';
import {
  amountOwed,
  preparePayout,
  releasePayout,
} from '../src/modules/billing-settlement/application/payout';
import {
  reviewPayoutAccount,
  submitPayoutAccount,
} from '../src/modules/billing-settlement/application/payout-account';
import {
  createCadreLevel,
  createRegistrationCategory,
} from '../src/modules/config/hierarchy-config';
import { recordPractitionerStanding } from '../src/modules/practitioners/application/verification';
import {
  beginIncidentReview,
  closeIncident,
  reportIncident,
} from '../src/modules/clinical-incidents/application/incident';
import {
  reinstateAccount,
  suspendAccount,
} from '../src/modules/clinical-incidents/application/suspension';
import {
  submitSuggestion,
  triageSuggestion,
} from '../src/modules/suggestions/application/suggestion';
import {
  beginReview,
  raiseDispute,
  resolveDispute,
  withdrawDispute,
} from '../src/modules/disputes/application/dispute';
import { DISPUTE_RESPONSE_DAYS } from '../src/modules/disputes/domain/dispute';
import {
  attachEvidence,
  requestEvidenceUploadUrl,
} from '../src/modules/disputes/application/evidence';
import {
  listAwaitingFault,
  recordFault,
  sweepUnhonouredAssignments,
} from '../src/modules/cancellations-sanctions/application/fault';
import {
  decideExcusal,
  requestExcusal,
} from '../src/modules/cancellations-sanctions/application/excusal';
import {
  acceptAgreement,
  publishAgreement,
  recordConsent,
} from '../src/modules/audit-compliance/application/consent';
import { closeRequest, raiseRequest } from '../src/modules/audit-compliance/application/data-subject';

import { DEMO_PASSWORD, assertLocal, demoPasswordHash, syncRoles } from './support/demo';


/**
 * How this script recognises what it made. `.test` is a reserved top-level
 * domain, so no demo address can ever reach a real inbox.
 */
const EMAIL_DOMAIN = 'demo.medilink.test';
const LEGACY_EMAIL_PREFIX = 'seeddemo.';
const CAC_PREFIX = 'RC77';
const AGREEMENT_PREFIX = 'seeddemo-';
const SANCTIONS_OWNER = 'seed-demo';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** West Africa Time: UTC+1 all year, no daylight saving. */
const WAT = HOUR;

/** Sixteen weeks: long enough to reach Democracy Day and three paid invoices. */
const HISTORY_DAYS = 112;

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.info(message);
}

// ------------------------------------------------------------------ time

/** A wall-clock time in Abuja, `offsetDays` from today. */
function watDay(offsetDays: number, hour = 0, minute = 0): Date {
  const local = new Date(Date.now() + WAT);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + offsetDays,
      hour,
      minute,
    ) - WAT,
  );
}

function watWeekday(at: Date): number {
  return new Date(at.getTime() + WAT).getUTCDay();
}

function watHour(at: Date): number {
  return new Date(at.getTime() + WAT).getUTCHours();
}

function watDateKey(at: Date): string {
  return new Date(at.getTime() + WAT).toISOString().slice(0, 10);
}

const addMinutes = (at: Date, minutes: number) => new Date(at.getTime() + minutes * MINUTE);
const addHours = (at: Date, hours: number) => new Date(at.getTime() + hours * HOUR);
const addDays = (at: Date, days: number) => new Date(at.getTime() + days * DAY);

/** A backdated timestamp must never land in the future. */
function notAfterNow(at: Date): Date {
  const ceiling = Date.now() - MINUTE;
  return at.getTime() > ceiling ? new Date(ceiling) : at;
}

/** The first day at or after `fromOffset` that falls on one of `weekdays`. */
function nextDay(fromOffset: number, weekdays: readonly number[]): number {
  for (let offset = fromOffset; offset < fromOffset + 7; offset += 1) {
    if (weekdays.includes(watWeekday(watDay(offset, 12)))) return offset;
  }
  return fromOffset;
}

const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];
const EVERY_DAY: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

// ---------------------------------------------------------------- random

/** Deterministic, so two runs produce the same picture rather than noise. */
let seed = 20260928;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function between(low: number, high: number): number {
  return Math.floor(low + random() * (high - low + 1));
}

function chance(probability: number): boolean {
  return random() < probability;
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

// --------------------------------------------------------------- storage

/**
 * A minimal but genuinely valid PDF — a single blank page.
 *
 * Credential documents are private medical evidence, so the demo data must
 * not contain anything that looks like a real one. A blank page is honest
 * about being a placeholder and still opens in a viewer.
 */
const PLACEHOLDER_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj
trailer<</Root 1 0 R>>
%%EOF
`,
  'utf8',
);

/**
 * The browser's half of the signed-URL handshake, done with the app's own
 * internal client against the key the application issued.
 *
 * The signed URL names `STORAGE_PUBLIC_ENDPOINT` (localhost:9000), which a
 * browser on this laptop can reach and this container cannot — the fix in
 * 7d0c260 that made uploads work from a browser is exactly what stops a
 * script inside the container following the URL. Same object, same key,
 * same row; the application still HEADs it before trusting it.
 */
async function storePlaceholder(objectKey: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.STORAGE_BUCKET,
      Key: objectKey,
      Body: PLACEHOLDER_PDF,
      ContentType: 'application/pdf',
    }),
  );
}

// ---------------------------------------------------------------- people

interface Actor {
  id: string;
  fullName: string;
  phone: string;
}

type CategoryKey = 'doctor' | 'nurse' | 'pharmacist' | 'lab_scientist' | 'radiographer';
type Travel = 'SAME_LGA' | 'SAME_STATE' | 'ANYWHERE';
type Pattern = 'anytime' | 'weekday_days' | 'nights' | 'weekends_and_nights';
type OptionalCredential = 'nysc_certificate' | 'good_standing' | 'indemnity_cover';

/**
 * Where a practitioner stands. `complete` onboarding plus a `problem` is how
 * somebody who once worked ends up blocked; the other stages never finish.
 */
type Stage = 'complete' | 'credentials_pending' | 'more_info' | 'no_profile' | 'changes_needed';
type Problem = 'flagged' | 'suspended' | 'expired_licence' | 'registration_lapsed' | 'name_mismatch';

interface PractitionerSpec {
  /** Set for the ones printed on the login sheet. */
  key?: string;
  label?: string;
  fullName: string;
  phone?: string;
  category: CategoryKey;
  specialty?: string;
  years: number;
  state: string;
  lga: string;
  travel: Travel;
  pattern: Pattern;
  bio: string;
  joinedDaysAgo: number;
  stage?: Stage;
  problem?: Problem;
  optional?: OptionalCredential[];
  folio?: string;
  registrationExpires?: Date;
}

interface Practitioner extends Actor {
  spec: PractitionerSpec;
  stateId: string;
  lgaId: string;
  joinedAt: Date;
  /** No shift in the simulated history starts after this. */
  workUntil?: Date;
  /** Nor inside these windows (a suspension, a leave). */
  offWork: [Date, Date][];
}

/** Fixed numbers for everyone on the login sheet: +234 803 120 00NN. */
const phoneFor = (n: number) => `+2348031200${String(n).padStart(3, '0')}`;
let poolPhone = 100;
const nextPoolPhone = () => phoneFor((poolPhone += 1));

/**
 * Platform staff: two roles, four people.
 *
 * Operations, compliance and finance merged into `administrator`, so Adaeze,
 * Musa and Ifeoma now hold the same role and see the same console. They are
 * kept as three separate accounts on purpose — a real platform has more than
 * one administrator, and the merge is only convincing if you can sign in as
 * two of them and find the same screens.
 *
 * The phone numbers are unchanged. They are written on a login sheet and in
 * docs/testing-by-role.md, and a role merge is no reason to make somebody
 * relearn which number is theirs.
 */
const PLATFORM_STAFF = [
  { key: 'superadmin', role: 'super_administrator', fullName: 'Olufemi Adebayo-Cole', phone: phoneFor(1), label: 'Super administrator — every permission, including rate floors' },
  { key: 'operations', role: 'administrator', fullName: 'Adaeze Nwachukwu', phone: phoneFor(2), label: 'Administrator — onboarding, verification, casework, money' },
  { key: 'compliance', role: 'administrator', fullName: 'Musa Ibrahim Danjuma', phone: phoneFor(3), label: 'Administrator — was compliance; same console as Adaeze now' },
  { key: 'finance', role: 'administrator', fullName: 'Ifeoma Chukwuemeka', phone: phoneFor(4), label: 'Administrator — was finance; same console as Adaeze now' },
  /**
   * A second super administrator, and the reason is operational rather than
   * cosmetic.
   *
   * Only a super administrator may revoke a super administrator, and
   * `revokeGrant` refuses to remove the last account holding `config.manage`
   * — otherwise two of them could remove each other down to zero and nobody
   * left could ever appoint a replacement. With two, removing either one is
   * possible but leaves no margin: the survivor cannot then be replaced if
   * they lose their phone. Three is the smallest number where somebody can
   * leave, be removed, and the platform still has a spare.
   */
  { key: 'deputy', role: 'super_administrator', fullName: 'Zainab Bello-Hassan', phone: phoneFor(5), label: 'Super administrator — the spare, so the role is never down to one' },
] as const;

const FCT = 'FC';

/**
 * The practitioner population.
 *
 * Numbered 21–30 are the named accounts; the rest are the pool a real
 * hospital draws from. Every specialty the flagship posts has at least two
 * holders within travelling distance, because a specialty on a request is a
 * hard requirement in the matcher and one holder cannot produce a decline.
 */
const PRACTITIONERS: PractitionerSpec[] = [
  // ---- the named accounts
  {
    key: 'practitioner', label: 'Practitioner — fully cleared doctor, live shift now', phone: phoneFor(21),
    fullName: 'Amina Yusuf', category: 'doctor', specialty: 'emergency_medicine', years: 7,
    state: FCT, lga: 'Abuja Municipal', travel: 'ANYWHERE', pattern: 'anytime', joinedDaysAgo: 330,
    optional: ['nysc_certificate', 'good_standing', 'indemnity_cover'],
    bio: 'Emergency physician, seven years in A&E across FCT hospitals. ATLS and ACLS certified; comfortable running a resus bay alone overnight.',
  },
  {
    key: 'nurse', label: 'Practitioner — ICU nurse, shift starts within the hour', phone: phoneFor(22),
    fullName: 'Blessing Okoro', category: 'nurse', years: 9,
    state: FCT, lga: 'Gwagwalada', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 290,
    optional: ['indemnity_cover'],
    bio: 'Critical care nurse (post-basic ICU certificate, UATH). Ventilated patients, CVP lines and inotrope infusions.',
  },
  {
    key: 'awaitingReview', label: 'Practitioner — credentials submitted, awaiting compliance', phone: phoneFor(23),
    fullName: 'Tunde Bakare', category: 'doctor', specialty: 'internal_medicine', years: 3,
    state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 3,
    stage: 'credentials_pending', optional: ['nysc_certificate'],
    bio: 'Medical officer, three years post-housemanship. Looking for weekend and night cover alongside a residency application.',
  },
  {
    key: 'moreInfo', label: 'Practitioner — asked to resupply a document', phone: phoneFor(24),
    fullName: 'Ibrahim Lawal', category: 'doctor', specialty: 'paediatrics', years: 5,
    state: 'NA', lga: 'Karu', travel: 'ANYWHERE', pattern: 'anytime', joinedDaysAgo: 9,
    stage: 'more_info', optional: ['good_standing'],
    bio: 'Paediatric senior registrar (Part I, West African College of Physicians).',
  },
  {
    key: 'newSignup', label: 'Practitioner — just registered, no profile yet', phone: phoneFor(25),
    fullName: 'Grace Adeyemi', category: 'pharmacist', years: 2,
    state: FCT, lga: 'Bwari', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 1,
    stage: 'no_profile', bio: '',
  },
  {
    key: 'flagged', label: 'Practitioner — sanctions screening match, blocked', phone: phoneFor(26),
    fullName: 'Emeka Nwosu', category: 'doctor', specialty: 'general_practice', years: 4,
    state: FCT, lga: 'Kuje', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 21,
    problem: 'flagged', folio: 'MDCN/R/40917',
    bio: 'General practitioner; outpatient clinics and ward cover.',
  },
  {
    key: 'suspended', label: 'Practitioner — suspended after an incident (sign-in refused)', phone: phoneFor(27),
    fullName: 'Kelechi Umeh', category: 'doctor', specialty: 'obstetrics_gynaecology', years: 6,
    state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'nights', joinedDaysAgo: 240,
    problem: 'suspended', optional: ['nysc_certificate'],
    bio: 'Obstetrics and gynaecology registrar; labour ward nights.',
  },
  {
    key: 'expiredLicence', label: 'Practitioner — practising licence lapsed, blocked', phone: phoneFor(28),
    fullName: 'Yetunde Afolabi', category: 'doctor', specialty: 'emergency_medicine', years: 10,
    state: FCT, lga: 'Bwari', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 380,
    problem: 'expired_licence', optional: ['good_standing'],
    bio: 'Emergency medicine fellow (FWACS). Ten years across A&E and trauma units.',
  },
  {
    key: 'nameMismatch', label: 'Practitioner — NIN name does not match account', phone: phoneFor(29),
    fullName: 'Samuel Garba', category: 'nurse', years: 4,
    state: FCT, lga: 'Bwari', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 12,
    problem: 'name_mismatch',
    bio: 'Registered nurse, medical and surgical wards.',
  },
  {
    key: 'registrationLapsed', label: 'Practitioner — NMCN licence expired, blocked', phone: phoneFor(30),
    fullName: 'Rukayat Adebisi', category: 'nurse', years: 6,
    state: 'NA', lga: 'Karu', travel: 'ANYWHERE', pattern: 'anytime', joinedDaysAgo: 260,
    problem: 'registration_lapsed', registrationExpires: new Date('2026-09-15T22:59:59.000Z'),
    bio: 'A&E nurse; triage and minor injuries.',
  },
  {
    key: 'changesNeeded', label: 'Practitioner — a document was refused, must resubmit (changes needed)', phone: phoneFor(31),
    fullName: 'Hadiza Lawan', category: 'doctor', specialty: 'general_practice', years: 4,
    state: FCT, lga: 'Gwagwalada', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 6,
    stage: 'changes_needed',
    bio: 'General practitioner; primary care and outpatient clinics. Locum cover at weekends.',
  },

  // ---- FCT-area doctors
  { fullName: 'Chidi Okafor', category: 'doctor', specialty: 'general_practice', years: 4, state: FCT, lga: 'Abuja Municipal', travel: 'ANYWHERE', pattern: 'anytime', joinedDaysAgo: 300, optional: ['nysc_certificate'], bio: 'Medical officer covering wards and emergencies; happy to travel for weekend work.' },
  { fullName: 'Zainab Suleiman', category: 'doctor', specialty: 'paediatrics', years: 8, state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'weekday_days', joinedDaysAgo: 280, folio: 'MDCN/R/58342', optional: ['good_standing', 'indemnity_cover'], bio: 'Paediatrician; children’s emergency and neonatal resuscitation (NRP).' },
  { fullName: 'Halima Sani', category: 'doctor', specialty: 'paediatrics', years: 3, state: FCT, lga: 'Gwagwalada', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 150, bio: 'Paediatric registrar at a teaching hospital; locum days on rota breaks.' },
  { fullName: 'Olumide Oyelaran', category: 'doctor', specialty: 'obstetrics_gynaecology', years: 11, state: FCT, lga: 'Bwari', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 320, optional: ['good_standing', 'indemnity_cover'], bio: 'Consultant obstetrician; emergency caesarean sections and high-risk labour.' },
  { fullName: 'Nkechi Obiora', category: 'doctor', specialty: 'obstetrics_gynaecology', years: 7, state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'nights', joinedDaysAgo: 210, bio: 'O&G senior registrar; labour ward nights preferred.' },
  { fullName: 'Fatima Bello', category: 'doctor', specialty: 'anaesthesia', years: 12, state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'weekday_days', joinedDaysAgo: 330, optional: ['good_standing', 'indemnity_cover'], bio: 'Consultant anaesthetist; general, obstetric and paediatric lists.' },
  { fullName: 'Bashir Aliyu', category: 'doctor', specialty: 'anaesthesia', years: 9, state: 'NI', lga: 'Suleja', travel: 'ANYWHERE', pattern: 'anytime', joinedDaysAgo: 190, bio: 'Anaesthetist; spinal and regional blocks, day-case lists.' },
  { fullName: 'Segun Balogun', category: 'doctor', specialty: 'internal_medicine', years: 6, state: 'NA', lga: 'Karu', travel: 'ANYWHERE', pattern: 'weekends_and_nights', joinedDaysAgo: 260, bio: 'Internal medicine registrar; weekend ward cover.' },
  { fullName: 'Aisha Mohammed', category: 'doctor', specialty: 'emergency_medicine', years: 5, state: 'NI', lga: 'Suleja', travel: 'ANYWHERE', pattern: 'anytime', joinedDaysAgo: 230, optional: ['indemnity_cover'], bio: 'Emergency medicine registrar; trauma and resuscitation.' },
  { fullName: 'Obinna Eze', category: 'doctor', specialty: 'general_surgery', years: 9, state: FCT, lga: 'Kuje', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 270, bio: 'General surgery senior registrar; acute surgical take and ward cover.' },

  // ---- FCT-area nurses and allied professionals
  { fullName: 'Ngozi Eze', category: 'nurse', years: 12, state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'nights', joinedDaysAgo: 310, optional: ['indemnity_cover'], bio: 'ICU nursing sister, twelve years in critical care.' },
  { fullName: 'Hadiza Musa', category: 'nurse', years: 8, state: FCT, lga: 'Bwari', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 250, bio: 'Registered midwife; labour ward and antenatal clinic.' },
  { fullName: 'Joy Okafor', category: 'nurse', years: 5, state: FCT, lga: 'Kuje', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 200, bio: 'Registered nurse; ICU step-down and medical wards.' },
  { fullName: 'Esther Danladi', category: 'nurse', years: 10, state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 275, bio: 'Midwife; labour ward coordinator on her home unit.' },
  { fullName: 'Comfort Ojo', category: 'nurse', years: 7, state: FCT, lga: 'Abuja Municipal', travel: 'ANYWHERE', pattern: 'nights', joinedDaysAgo: 180, bio: 'Critical care nurse; nights only while studying for a BNSc.' },
  { fullName: 'Uche Nwankwo', category: 'pharmacist', years: 6, state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 240, bio: 'Hospital pharmacist; inpatient dispensing and controlled drugs.' },
  { fullName: 'Rashida Idris', category: 'pharmacist', years: 4, state: FCT, lga: 'Gwagwalada', travel: 'SAME_STATE', pattern: 'nights', joinedDaysAgo: 170, bio: 'Clinical pharmacist; night dispensing cover.' },
  { fullName: 'Ikenna Obi', category: 'lab_scientist', years: 7, state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 230, bio: 'Medical laboratory scientist; haematology and blood transfusion.' },
  { fullName: 'Salamatu Yakubu', category: 'lab_scientist', years: 5, state: FCT, lga: 'Bwari', travel: 'SAME_STATE', pattern: 'nights', joinedDaysAgo: 160, bio: 'Medical laboratory scientist; clinical chemistry.' },
  { fullName: 'Victor Akpan', category: 'radiographer', years: 8, state: FCT, lga: 'Abuja Municipal', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 220, bio: 'Radiographer; plain film, ultrasound and CT.' },
  { fullName: 'Mercy Etim', category: 'radiographer', years: 4, state: FCT, lga: 'Kuje', travel: 'SAME_STATE', pattern: 'weekends_and_nights', joinedDaysAgo: 140, bio: 'Radiographer; weekend X-ray sessions.' },

  // ---- Lagos
  { fullName: 'Folake Adebayo', category: 'doctor', specialty: 'general_practice', years: 6, state: 'LA', lga: 'Ikeja', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 260, bio: 'Medical officer; private hospital night cover in Ikeja and Maryland.' },
  { fullName: 'Kunle Ogunleye', category: 'doctor', specialty: 'emergency_medicine', years: 8, state: 'LA', lga: 'Surulere', travel: 'SAME_STATE', pattern: 'nights', joinedDaysAgo: 230, bio: 'Emergency physician; nights.' },
  { fullName: 'Precious Nnamdi', category: 'nurse', years: 5, state: 'LA', lga: 'Ikeja', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 200, bio: 'Registered nurse; surgical wards.' },
  { fullName: 'Tosin Alabi', category: 'nurse', years: 7, state: 'LA', lga: 'Kosofe', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 190, bio: 'Registered nurse and midwife.' },

  // ---- Kano
  { fullName: 'Abdullahi Umar', category: 'doctor', specialty: 'general_practice', years: 5, state: 'KN', lga: 'Kano Municipal', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 250, bio: 'Medical officer; general outpatients and emergencies. Hausa and English.' },
  { fullName: 'Maryam Garba', category: 'doctor', specialty: 'obstetrics_gynaecology', years: 9, state: 'KN', lga: 'Fagge', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 210, bio: 'O&G registrar; labour ward and gynae emergencies.' },
  { fullName: 'Aminat Bello', category: 'nurse', years: 6, state: 'KN', lga: 'Kano Municipal', travel: 'SAME_STATE', pattern: 'anytime', joinedDaysAgo: 220, bio: 'Paediatric nurse.' },
  { fullName: 'Usman Bala', category: 'nurse', years: 8, state: 'KN', lga: 'Gwale', travel: 'SAME_STATE', pattern: 'nights', joinedDaysAgo: 180, bio: 'Registered nurse; nights on paediatric and medical wards.' },
];

/**
 * An INTERNAL sanctions entry naming Emeka Nwosu's folio, and an MDCN list
 * entry that shares Zainab Suleiman's *name* but not her folio.
 *
 * The first is a genuine match the compliance queue has to act on. The second
 * is the false positive every name-based screen produces, cleared by an
 * officer with a written reason — the only way a flag should ever go away.
 * Both are fictional and say so; `prisma/seed.ts` deliberately ships an empty
 * list, and this owner tag is what lets `clear()` take these back out.
 */
const SANCTIONED_ENTRIES = [
  {
    sourceList: 'INTERNAL' as const,
    fullName: 'Emeka C. Nwosu',
    folioNumber: 'MDCN/R/40917',
    reason: 'Demo data (fictional). Removed from a partner hospital panel in 2025 after falsified locum timesheets.',
    listedAt: new Date('2025-11-03T00:00:00.000Z'),
  },
  {
    sourceList: 'MDCN_QUACK_LIST' as const,
    fullName: 'Zainab Suleiman',
    folioNumber: 'MDCN/R/31190',
    reason: 'Demo data (fictional). Practising without registration, Sokoto, 2024.',
    listedAt: new Date('2024-06-18T00:00:00.000Z'),
  },
];

const DEVICES = [
  'Tecno Camon 20', 'Infinix Hot 40', 'Samsung Galaxy A15', 'iPhone 13', 'itel S23',
  'Redmi Note 12', 'iPhone 11', 'Samsung Galaxy A34',
];

// ------------------------------------------------------------- facilities

interface Need {
  dept: string;
  category: CategoryKey;
  specialty?: string;
  shift: 'DAY' | 'NIGHT';
  startHour: number;
  hours: number;
  /** Naira per hour, low and high. Always above the rate floor. */
  rate: [number, number];
  perWeek: number;
  days?: readonly number[];
  headcount?: [number, number];
  notes: string;
}

const FLAGSHIP_NEEDS: Need[] = [
  {
    dept: 'Accident & Emergency', category: 'doctor', specialty: 'emergency_medicine', shift: 'NIGHT',
    startHour: 20, hours: 12, rate: [8_000, 9_500], perWeek: 2.5,
    notes: 'A&E night cover: 14 trolleys and two resuscitation bays. Handover from the day registrar at 19:45 in the A&E doctors’ room.',
  },
  {
    dept: 'Medical wards', category: 'doctor', shift: 'DAY', startHour: 8, hours: 12,
    rate: [6_500, 7_500], perWeek: 1, days: [0, 6],
    notes: 'Weekend cover for Male and Female Medical (52 beds). Review the overnight admissions first; the consultant on call is available by phone.',
  },
  {
    dept: 'Paediatrics', category: 'doctor', specialty: 'paediatrics', shift: 'DAY', startHour: 8, hours: 12,
    rate: [7_500, 9_000], perWeek: 1, days: WEEKDAYS,
    notes: 'Children’s Emergency Room and the paediatric ward round. SCBU is covered by the neonatal team.',
  },
  {
    dept: 'Labour ward', category: 'doctor', specialty: 'obstetrics_gynaecology', shift: 'NIGHT',
    startHour: 20, hours: 12, rate: [10_000, 12_500], perWeek: 1,
    notes: 'Twelve delivery beds with emergency theatre access. Must be able to perform a caesarean section; the consultant is on call from home.',
  },
  {
    dept: 'Main theatre', category: 'doctor', specialty: 'anaesthesia', shift: 'DAY', startHour: 8, hours: 10,
    rate: [12_000, 15_000], perWeek: 1, days: WEEKDAYS,
    notes: 'Elective general surgery and orthopaedic list in theatre 2. Pre-operative assessment at 07:30 in the anaesthetic room.',
  },
  {
    dept: 'Intensive Care Unit', category: 'nurse', shift: 'NIGHT', startHour: 20, hours: 12,
    rate: [3_600, 4_500], perWeek: 2, headcount: [1, 2],
    notes: 'Eight-bed ICU, one-to-one or one-to-two by acuity. ICU experience required; ventilator competency is checked on arrival.',
  },
  {
    dept: 'Labour ward', category: 'nurse', shift: 'DAY', startHour: 8, hours: 12,
    rate: [3_000, 3_800], perWeek: 1,
    notes: 'Registered midwife for the labour ward day shift. Report to the midwife in charge at 07:45.',
  },
  {
    dept: 'Inpatient pharmacy', category: 'pharmacist', shift: 'NIGHT', startHour: 20, hours: 12,
    rate: [4_000, 5_000], perWeek: 0.5,
    notes: 'Night dispensing for the wards and A&E, including the controlled drugs register. A pharmacy technician is on site until midnight.',
  },
  {
    dept: 'Laboratory', category: 'lab_scientist', shift: 'NIGHT', startHour: 20, hours: 12,
    rate: [3_500, 4_500], perWeek: 0.5,
    notes: 'Emergency haematology, chemistry and blood bank crossmatching overnight. Sign the analyser QC log at the start of the shift.',
  },
  {
    dept: 'Radiology', category: 'radiographer', shift: 'DAY', startHour: 8, hours: 8,
    rate: [4_000, 5_000], perWeek: 0.5, days: [6],
    notes: 'Saturday X-ray and ultrasound session. CT is on call only; the radiologist reports remotely.',
  },
];

const LAGOS_NEEDS: Need[] = [
  {
    dept: 'Night medical cover', category: 'doctor', shift: 'NIGHT', startHour: 20, hours: 12,
    rate: [7_000, 8_500], perWeek: 1,
    notes: 'Sole doctor overnight for a 40-bed private hospital: emergencies, ward calls and admissions.',
  },
  {
    dept: 'Female surgical ward', category: 'nurse', shift: 'DAY', startHour: 8, hours: 12,
    rate: [3_000, 3_600], perWeek: 1,
    notes: 'Eighteen beds, mostly post-operative. Drug round at 10:00 and 18:00.',
  },
];

const KANO_NEEDS: Need[] = [
  {
    dept: 'General outpatients', category: 'doctor', shift: 'DAY', startHour: 8, hours: 12,
    rate: [6_000, 7_000], perWeek: 1, days: WEEKDAYS,
    notes: 'General outpatient clinic, usually 60–80 patients. Hausa-speaking is an advantage.',
  },
  {
    dept: 'Paediatric ward', category: 'nurse', shift: 'NIGHT', startHour: 20, hours: 12,
    rate: [3_300, 3_900], perWeek: 0.7,
    notes: 'Twenty-four cots; two nurses on nights with a doctor on call.',
  },
];

interface Facility {
  id: string;
  name: string;
  stateId: string;
  lgaId: string;
  flagship: boolean;
  owner: Actor;
  scheduler: Actor;
  administrator?: Actor;
  financeOfficer?: Actor;
  needs: Need[];
  /** The flagship runs the matcher on every shift; the small ones invite who they know. */
  usesMatching: boolean;
}

const CANCELLATION_TERMS = [
  'Either party may cancel up to 24 hours before the shift without penalty. Inside 24 hours the shift is payable in full unless cover is agreed.',
  'A facility cancelling inside 12 hours of the start pays 50% of the shift value. A practitioner cancelling inside 12 hours is recorded as a late cancellation.',
];

/** What a practitioner says when they turn a shift down. These feed the suggestion log. */
const DECLINE_REASONS = [
  'The rate is below what I am paid for the same shift at another hospital.',
  'Too far to travel for one night, and there is no safe transport after 10pm.',
  'Less than a day of notice; I could not rearrange my clinic.',
  'Already on nights that week and I need the rest day.',
  'I am sitting my fellowship exam that week.',
  'I am only taking weekend shifts this month.',
];

const MANUAL_ATTENDANCE_REASONS = [
  'Hospital network down from 19:00; times taken from the ward attendance register and countersigned by the nurse in charge.',
  'Practitioner’s phone battery died before check-out; check-out time taken from the handover sheet.',
  'No check-in code could be issued: the scheduler’s laptop was in for repair. Times from the paper register.',
];

const REJECTION_NOTES = [
  'Check-out is recorded 90 minutes after the scheduled end, but the handover sheet shows the day team took over on time. Please confirm.',
  'Break shows 0 minutes but the ward log records a 45-minute break at 01:00. Please correct and resubmit.',
];

const CORRECTION_REASONS = [
  'Check-out corrected to the time on the ward handover log, signed by the nurse in charge.',
  'Break corrected to 45 minutes per the ward log; agreed with the practitioner by phone.',
];

const LATE_CANCEL_REASONS = [
  'Practitioner called in sick four hours before the shift; cover arranged from the match list.',
  'Practitioner had a family emergency and asked to be released; replacement confirmed the same afternoon.',
];

const REQUEST_CANCEL_REASONS = [
  'Elective list cancelled: the consultant surgeon is away at a conference.',
  'Covered internally after a staff nurse returned early from leave.',
  'Ward closed for fumigation that night; admissions diverted to Ward 4.',
];

const ENGAGEMENT_TERMS_BODY =
  'This agreement covers your engagement as an independent practitioner offering shift cover through Medilink. You are responsible for holding a current practising licence and for the accuracy of every credential you submit. Payment follows an approved timesheet, at the rate shown on the shift before you accepted it. Either side may end this agreement at any time; shifts already confirmed remain payable under their own cancellation terms.';

const FACILITY_TERMS_BODY =
  'This agreement covers your use of Medilink to source locum cover. Facilities must hold a current CAC registration and an operating licence before publishing a shift, and must honour the rate shown at the time a practitioner accepted it. Invoices are raised monthly against approved timesheets and are payable within the terms shown on the invoice. A facility that repeatedly cancels confirmed shifts without notice may have its account reviewed.';

const PRIVACY_NOTICE_2025_BODY =
  'Medilink processes your name, contact details, professional credentials and work history to operate the marketplace and to verify your identity and licence to practise. You can request a copy of what is held about you at any time.';

const PRIVACY_NOTICE_2026_BODY =
  'Medilink processes your name, contact details, professional credentials and work history to operate the marketplace and to meet regulatory obligations under the Nigeria Data Protection Act 2023, including verifying your identity and licence to practise. Some processing rests on your consent and can be withdrawn; some, such as identity verification, is required by law and cannot be. This version adds how long records are kept after you leave, and your right to have your data moved to another service. You can request a copy of what is held about you, or ask for it to be corrected or erased, at any time from your account.';

// ------------------------------------------------------------ reference

interface Reference {
  categories: Map<string, { id: string; regulator: string }>;
  specialties: Map<string, string>;
  credentialTypes: Map<string, { id: string; verificationMethod: string; expires: boolean; reviewDays: number }>;
  facilityTypes: Map<string, string>;
  states: Map<string, string>;
  lgas: Map<string, string>;
}

async function loadReference(): Promise<Reference> {
  const [categories, specialties, credentialTypes, facilityTypes, states, lgas] = await Promise.all([
    prisma.professionalCategory.findMany(),
    prisma.specialty.findMany(),
    prisma.credentialType.findMany(),
    prisma.facilityType.findMany(),
    prisma.state.findMany(),
    prisma.lga.findMany({ include: { state: { select: { code: true } } } }),
  ]);
  if (categories.length === 0 || states.length === 0 || lgas.length === 0) {
    throw new Error('Run `pnpm db:seed` first — the controlled vocabularies are empty.');
  }
  return {
    categories: new Map(categories.map((row) => [row.key, { id: row.id, regulator: row.regulator }])),
    specialties: new Map(specialties.map((row) => [row.key, row.id])),
    credentialTypes: new Map(
      credentialTypes.map((row) => [
        row.key,
        { id: row.id, verificationMethod: row.verificationMethod, expires: row.expires, reviewDays: row.reviewDays },
      ]),
    ),
    facilityTypes: new Map(facilityTypes.map((row) => [row.key, row.id])),
    states: new Map(states.map((row) => [row.code, row.id])),
    lgas: new Map(lgas.map((row) => [`${row.state.code}:${row.name}`, row.id])),
  };
}

/**
 * Pay floors for the categories `prisma/seed.ts` publishes none for.
 *
 * The platform seed states floors for doctors and nurses only: what the other
 * professions must be paid is the regulators' to say, and a shift for a category
 * with no floor is refused rather than let through (RAT-01). The demo books every
 * category, so it publishes a floor for each of the rest to let those shifts be
 * created. These are demo figures, set below every rate the demo uses, and are not
 * what any profession is owed. A floor somebody has already published is left alone,
 * so running the demo does not overwrite what was set on the Pay floors screen.
 */
async function ensureDemoRateFloors(ref: Reference): Promise<void> {
  const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
  const demo = { day: 100_000, night: 130_000 } as const;

  for (const key of ref.categories.keys()) {
    for (const shiftType of ['day', 'night'] as const) {
      const existing = await prisma.rateFloor.count({ where: { categoryKey: key, shiftType } });
      if (existing > 0) continue;
      await prisma.rateFloor.create({
        data: {
          categoryKey: key,
          specialtyKey: '*',
          shiftType,
          minHourlyKobo: demo[shiftType],
          effectiveFrom,
          owner: 'demo-seed',
        },
      });
    }
  }
}

function lgaId(ref: Reference, state: string, lga: string): string {
  const id = ref.lgas.get(`${state}:${lga}`);
  if (!id) throw new Error(`No LGA called ${lga} in ${state}.`);
  return id;
}

// ------------------------------------------------------------------ roles

/**
 * Roles and their permissions, brought up to date with ROLE_PERMISSIONS.
 *
 * The same upsert `prisma/seed.ts` does. Repeated here because a role row
 * whose permissions lag the code authorises less than the code says, and the
 * first sign is a demo account 403ing on a screen it should open — the
 * finance officer's practitioner lookup was exactly that.
 */
let cachedHash: string | null = null;

function emailFor(fullName: string, phone: string): string {
  const slug = fullName
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .trim()
    .split(/[\s-]+/)
    .join('.');
  return `${slug}.${phone.slice(-3)}@${EMAIL_DOMAIN}`;
}

/**
 * A signed-up user with a verified phone and a password.
 *
 * Registration proper needs the OTP sent to the phone, which a script cannot
 * read — the code is only ever stored hashed. So this writes the row
 * registration would have left behind, and nothing else: roles come from the
 * application's own grant paths.
 */
async function makeUser(input: {
  fullName: string;
  phone: string;
  status: 'ACTIVE' | 'UNDER_REVIEW';
  joinedAt: Date;
}): Promise<Actor> {
  // One hash for every account: they share a password anyway, and argon2 is
  // deliberately slow — sixty of them would be most of the run.
  cachedHash ??= await demoPasswordHash();
  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone: input.phone,
      status: input.status,
      passwordHash: cachedHash,
      phoneVerifiedAt: input.joinedAt,
      email: emailFor(input.fullName, input.phone),
      createdAt: input.joinedAt,
    },
  });
  return { id: user.id, fullName: input.fullName, phone: input.phone };
}

const SUPER_PERMISSIONS: string[] = ROLE_PERMISSIONS.super_administrator ?? [];
const OWNER_PERMISSIONS: string[] = ROLE_PERMISSIONS.facility_owner ?? [];

// ------------------------------------------------------------------ clear

/**
 * Removes everything a previous run made, so the script is re-runnable.
 *
 * Users are found by their demo email domain and facilities by their CAC
 * prefix. Invitations, suggestions, notifications, stored objects and ledger
 * rows carry no foreign key back to either, so each is found explicitly
 * rather than trusted to cascade.
 */
async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { endsWith: `@${EMAIL_DOMAIN}` } },
        { email: { startsWith: LEGACY_EMAIL_PREFIX } },
      ],
    },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);
  const facilities = await prisma.facility.findMany({
    where: { cacNumber: { startsWith: CAC_PREFIX } },
    select: { id: true },
  });
  const facilityIds = facilities.map((row) => row.id);
  const versions = await prisma.agreementVersion.findMany({
    where: { identifier: { startsWith: AGREEMENT_PREFIX } },
    select: { id: true },
  });
  const versionIds = versions.map((row) => row.id);

  if (userIds.length > 0 || facilityIds.length > 0) {
    const requests = await prisma.serviceRequest.findMany({
      where: { facilityId: { in: facilityIds } },
      select: { id: true },
    });
    const requestIds = requests.map((row) => row.id);
    const invitations = await prisma.invitation.findMany({
      where: { OR: [{ serviceRequestId: { in: requestIds } }, { userId: { in: userIds } }] },
      select: { id: true },
    });

    /**
     * Whole transactions, not entries by subject.
     *
     * `CASH` and `PLATFORM_REVENUE` carry no subject, so deleting by subject
     * removes one side of a payment and leaves the other — which is how a
     * re-run once left the ledger holding half-transactions and a balance
     * that should have been zero.
     */
    const touched = await prisma.ledgerEntry.findMany({
      where: { subjectId: { in: [...userIds, ...facilityIds] } },
      select: { transactionId: true },
      distinct: ['transactionId'],
    });
    await prisma.ledgerEntry.deleteMany({
      where: { transactionId: { in: touched.map((row) => row.transactionId) } },
    });
    await prisma.payout.deleteMany({ where: { practitionerId: { in: userIds } } });
    await prisma.invoice.deleteMany({ where: { facilityId: { in: facilityIds } } });
    await prisma.clinicalIncident.deleteMany({ where: { facilityId: { in: facilityIds } } });
    await prisma.suggestion.deleteMany({
      where: {
        OR: [{ raisedBy: { in: userIds } }, { sourceRef: { in: invitations.map((row) => row.id) } }],
      },
    });
    await prisma.notificationMessage.deleteMany({ where: { userId: { in: userIds } } });
    // Assignments go before requests and users: both keys are Restrict, which
    // is right — removing a facility must never silently remove the shifts
    // somebody worked for it.
    await prisma.assignment.deleteMany({
      where: { OR: [{ serviceRequestId: { in: requestIds } }, { userId: { in: userIds } }] },
    });
    await prisma.invitation.deleteMany({ where: { id: { in: invitations.map((row) => row.id) } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } });
    await prisma.storedObject.deleteMany({
      where: { OR: [{ ownerUserId: { in: userIds } }, { scopeId: { in: facilityIds } }] },
    });
  }

  // Acceptances are Restrict against the version, and anybody — not only a
  // demo account — may have accepted one while clicking around.
  await prisma.agreementAcceptance.deleteMany({ where: { versionId: { in: versionIds } } });
  if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.agreementVersion.deleteMany({ where: { id: { in: versionIds } } });

  await prisma.screeningResult.deleteMany({ where: { matchedEntry: { owner: SANCTIONS_OWNER } } });
  await prisma.sanctionedEntry.deleteMany({ where: { owner: SANCTIONS_OWNER } });

  if (userIds.length > 0 || facilityIds.length > 0) {
    log(`  cleared ${userIds.length} users and ${facilityIds.length} facilities from a previous run`);
  }
}

/**
 * The two hourly sweeps, switched off while history is written.
 *
 * A historical shift is moved into the past *before* its check-in is
 * recorded, because the timesheet measures overtime against the scheduled
 * times. For those few milliseconds it is a confirmed shift that ended with
 * nobody attending — exactly what `assignment.unhonoured_sweep` exists to
 * find. `enabled` is the operator's own off switch on the job row; the
 * previous values are put back however this script ends.
 */
async function withSweepsPaused<T>(work: () => Promise<T>): Promise<T> {
  const keys = ['assignment.unhonoured_sweep', 'service_request.expiry_sweep'];
  const before = await prisma.scheduledJob.findMany({
    where: { key: { in: keys } },
    select: { key: true, enabled: true },
  });
  await prisma.scheduledJob.updateMany({ where: { key: { in: keys } }, data: { enabled: false } });
  try {
    return await work();
  } finally {
    for (const job of before) {
      await prisma.scheduledJob.update({ where: { key: job.key }, data: { enabled: job.enabled } });
    }
  }
}

// ------------------------------------------------------------ onboarding

const REGISTRATION_EXPIRY: Record<CategoryKey, Date> = {
  // MDCN, PCN, MLSCN and RRBN licences all run to the end of the year.
  doctor: new Date('2026-12-31T22:59:59.000Z'),
  pharmacist: new Date('2026-12-31T22:59:59.000Z'),
  lab_scientist: new Date('2026-12-31T22:59:59.000Z'),
  radiographer: new Date('2026-12-31T22:59:59.000Z'),
  // NMCN licences run for three years from issue.
  nurse: new Date('2027-08-31T22:59:59.000Z'),
};

function folioFor(spec: PractitionerSpec, index: number): string {
  if (spec.folio) return spec.folio;
  switch (spec.category) {
    case 'doctor':
      return `MDCN/R/${52_000 + index * 37}`;
    case 'nurse':
      return `RN/${140_000 + index * 53}`;
    case 'pharmacist':
      return `PCN/${21_000 + index * 29}`;
    case 'lab_scientist':
      return `MLSCN/R/${11_000 + index * 41}`;
    case 'radiographer':
      return `RRBN/R/${3_000 + index * 17}`;
  }
}

function credentialKeysFor(spec: PractitionerSpec): string[] {
  const base = spec.category === 'doctor'
    ? ['mdcn_practising_licence', 'nin_slip', 'mbbs_certificate']
    : ['nin_slip'];
  return [...base, ...(spec.optional ?? [])];
}

/** A standing weekly pattern, in WAT minutes since midnight. 1440 is midnight at the end. */
async function setAvailability(userId: string, pattern: Pattern): Promise<void> {
  const slots: { day: number; start: number; end: number }[] = [];
  for (const day of EVERY_DAY) {
    if (pattern === 'anytime') slots.push({ day, start: 0, end: 1440 });
    if (pattern === 'weekday_days' && day >= 1 && day <= 5) slots.push({ day, start: 7 * 60, end: 21 * 60 });
    // An end before the start runs into the next morning, which is what a
    // night is.
    if (pattern === 'nights') slots.push({ day, start: 19 * 60, end: 9 * 60 });
    if (pattern === 'weekends_and_nights') {
      if (day === 0 || day === 6) slots.push({ day, start: 0, end: 1440 });
      else slots.push({ day, start: 19 * 60, end: 9 * 60 });
    }
  }
  for (const slot of slots) {
    await addSlot({
      userId,
      kind: 'RECURRING_WEEKLY',
      dayOfWeek: slot.day,
      startMinute: slot.start,
      endMinute: slot.end,
    });
  }
}

interface OnboardContext {
  ref: Reference;
  compliance: Actor;
  engagementTerms: string;
  privacyNotice: string;
}

/**
 * Registration through to a screened, verified practitioner — or as far as
 * this one gets. Timestamps are moved back to when they joined afterwards, so
 * the credential queue reads as a queue and not as one burst this morning.
 */
async function onboard(spec: PractitionerSpec, index: number, ctx: OnboardContext): Promise<Practitioner> {
  const joinedAt = addHours(watDay(-spec.joinedDaysAgo, 9), between(0, 10));
  const actor = await makeUser({
    fullName: spec.fullName,
    phone: spec.phone ?? nextPoolPhone(),
    status: 'UNDER_REVIEW',
    joinedAt,
  });
  // What the PractitionerRegistered handler does once registration finishes.
  await grantPractitionerRoleOnRegistration(actor.id);

  await acceptAgreement({ userId: actor.id, versionId: ctx.engagementTerms });
  await acceptAgreement({ userId: actor.id, versionId: ctx.privacyNotice });
  await recordConsent({ userId: actor.id, purpose: 'CREDENTIAL_SHARING', granted: true, actorId: actor.id });
  await recordConsent({ userId: actor.id, purpose: 'PROFILE_VISIBILITY', granted: true, actorId: actor.id });
  await prisma.agreementAcceptance.updateMany({ where: { userId: actor.id }, data: { acceptedAt: joinedAt } });
  await prisma.consentRecord.updateMany({ where: { userId: actor.id }, data: { grantedAt: joinedAt } });

  const stateId = ctx.ref.states.get(spec.state)!;
  const homeLgaId = lgaId(ctx.ref, spec.state, spec.lga);
  const practitioner: Practitioner = { ...actor, spec, stateId, lgaId: homeLgaId, joinedAt, offWork: [] };

  if (spec.stage === 'no_profile') {
    // Screened at registration like everyone, before anything else is known.
    await screenPractitioner(actor.id);
    return practitioner;
  }

  const category = ctx.ref.categories.get(spec.category)!;
  await createProfile({
    userId: actor.id,
    professionalCategoryId: category.id,
    specialtyId: spec.specialty ? ctx.ref.specialties.get(spec.specialty) : undefined,
    yearsOfExperience: spec.years,
    bio: spec.bio,
    homeStateId: stateId,
    homeLgaId,
    travelPreference: spec.travel,
  });
  await setAvailability(actor.id, spec.pattern);

  const reviewedAt = addDays(joinedAt, 2);
  const nin = String(22_000_000_000 + index * 7_919_113 + between(0, 999)).slice(0, 11);

  if (spec.stage !== 'credentials_pending' && spec.stage !== 'changes_needed') {
    await recordIdentityVerification({
      userId: actor.id,
      nin,
      // The officer read the slip: "SAMAILA GARBA" on the NIN record against
      // "Samuel Garba" on the account. Close, and not the same person on paper.
      nameMatch: spec.problem !== 'name_mismatch',
      actorId: ctx.compliance.id,
    });
    await recordProfessionalRegistration({
      userId: actor.id,
      regulator: category.regulator,
      folioNumber: folioFor(spec, index),
      registrationStatus: 'ACTIVE',
      practiceType: spec.category === 'doctor' ? 'Full registration' : 'Registered practitioner',
      location: spec.state === FCT ? 'Abuja' : spec.state === 'LA' ? 'Lagos' : spec.state === 'KN' ? 'Kano' : 'North Central',
      // A lapse is applied after the history it would have stopped, not here:
      // recorded already lapsed, she could never have been activated.
      expiresAt: REGISTRATION_EXPIRY[spec.category],
      actorId: ctx.compliance.id,
    });
    await prisma.identityVerification.updateMany({
      where: { userId: actor.id },
      data: { verifiedAt: reviewedAt, evidenceRetrievedAt: reviewedAt },
    });
    // Regulator evidence goes stale after a year, so compliance re-checks the
    // register for anyone who has been with the platform that long.
    const evidenceAt = reviewedAt < watDay(-300) ? watDay(-between(20, 60), 11) : reviewedAt;
    await prisma.professionalRegistration.updateMany({
      where: { userId: actor.id },
      data: { evidenceRetrievedAt: evidenceAt, createdAt: reviewedAt },
    });
  }

  for (const key of credentialKeysFor(spec)) {
    const type = ctx.ref.credentialTypes.get(key);
    if (!type) continue;

    let documentObjectKey: string | undefined;
    let referenceNumber: string | undefined;
    if (type.verificationMethod === 'document_review') {
      const upload = await requestDocumentUploadUrl({
        userId: actor.id,
        filename: `${key}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: PLACEHOLDER_PDF.byteLength,
      });
      await storePlaceholder(upload.objectKey);
      documentObjectKey = upload.objectKey;
    } else {
      referenceNumber = key === 'nin_slip' ? nin : `APL/2026/${folioFor(spec, index).replace(/\D/g, '')}`;
    }

    const submission = await submitCredential({
      userId: actor.id,
      credentialTypeId: type.id,
      referenceNumber,
      documentObjectKey,
    });
    const submittedAt = addHours(joinedAt, between(2, 30));

    if (spec.stage === 'credentials_pending' || spec.stage === 'changes_needed') {
      await prisma.credentialSubmission.update({ where: { id: submission.id }, data: { createdAt: submittedAt } });
      continue;
    }

    if (spec.stage === 'more_info' && key === 'mbbs_certificate') {
      await reviewCredential({
        submissionId: submission.id,
        reviewerId: ctx.compliance.id,
        decision: 'request_info',
        reviewNotes:
          'The scan is cut off at the bottom: the registrar’s signature and the university seal are not visible. Please upload the full page.',
      });
    } else if (spec.stage === 'more_info' && key === 'good_standing') {
      await reviewCredential({
        submissionId: submission.id,
        reviewerId: ctx.compliance.id,
        decision: 'reject',
        reviewNotes: 'This certificate was issued in 2023. We need one issued within the last twelve months.',
      });
      // They sent a current one the next day, and it is waiting in the queue.
      const upload = await requestDocumentUploadUrl({
        userId: actor.id,
        filename: 'good_standing_2026.pdf',
        contentType: 'application/pdf',
        sizeBytes: PLACEHOLDER_PDF.byteLength,
      });
      await storePlaceholder(upload.objectKey);
      await submitCredential({ userId: actor.id, credentialTypeId: type.id, documentObjectKey: upload.objectKey });
    } else {
      await reviewCredential({ submissionId: submission.id, reviewerId: ctx.compliance.id, decision: 'approve' });
    }

    // Expiry is computed from the review, so it moves with it — a licence
    // reviewed last September lapses this September, which is how Yetunde
    // Afolabi's does.
    await prisma.credentialSubmission.update({
      where: { id: submission.id },
      data: {
        createdAt: submittedAt,
        reviewedAt,
        expiresAt: type.expires ? addDays(reviewedAt, type.reviewDays) : null,
      },
    });
  }

  // Registration-time screening: on the name alone for someone whose folio is
  // not recorded yet, on both once it is.
  await screenPractitioner(actor.id);

  // Everybody who got this far pressed "submit for approval" — that is what
  // put them in the officer's queue — and it is stamped back to when they would
  // have. Someone whose application is still incomplete simply cannot, and
  // the server says so; that is a state worth seeing, not an error to hide.
  const submittedForReviewAt = addHours(joinedAt, between(3, 36));
  try {
    await submitForReview({ userId: actor.id, hasAvailability: true });
    await prisma.practitionerProfile.updateMany({
      where: { userId: actor.id },
      data: { submittedForReviewAt },
    });
  } catch {
    // Incomplete application: left in draft.
  }

  // A document refused after submission sends the application back, which is
  // how Hadiza ends up with a notice, a reason, and a resubmit to do.
  if (spec.stage === 'changes_needed') {
    const mbbs = ctx.ref.credentialTypes.get('mbbs_certificate');
    const refused = mbbs
      ? await prisma.credentialSubmission.findFirst({ where: { userId: actor.id, credentialTypeId: mbbs.id } })
      : null;
    if (refused) {
      await reviewCredential({
        submissionId: refused.id,
        reviewerId: ctx.compliance.id,
        decision: 'reject',
        reviewNotes:
          'The certificate is a photograph of a photocopy and the university seal is not readable. Please upload a clear scan of the original.',
      });
      await prisma.credentialSubmission.update({
        where: { id: refused.id },
        data: { reviewedAt: addDays(joinedAt, 2) },
      });
    }
  }

  if (spec.problem === 'expired_licence') {
    practitioner.workUntil = addDays(reviewedAt, ctx.ref.credentialTypes.get('mdcn_practising_licence')!.reviewDays);
  }
  if (spec.problem === 'registration_lapsed') practitioner.workUntil = spec.registrationExpires;

  return practitioner;
}

// -------------------------------------------------------------- bookings

/**
 * Who is working when, across the whole simulation.
 *
 * Confirmation refuses an overlapping shift, but it checks at the moment of
 * confirming — when a historical shift is still sitting two hours in the
 * future — so it cannot see the history this script has already written.
 * Ten hours' rest between shifts is the rule a sensible rota keeps.
 */
const bookings = new Map<string, { start: number; end: number }[]>();
const REST = 10 * HOUR;

function isFree(userId: string, start: Date, end: Date): boolean {
  return !(bookings.get(userId) ?? []).some(
    (booking) => booking.start < end.getTime() + REST && booking.end + REST > start.getTime(),
  );
}

function book(userId: string, start: Date, end: Date): void {
  const list = bookings.get(userId) ?? [];
  list.push({ start: start.getTime(), end: end.getTime() });
  bookings.set(userId, list);
}

function travelOk(person: Practitioner, facility: Facility): boolean {
  if (person.spec.travel === 'ANYWHERE') return true;
  if (person.spec.travel === 'SAME_STATE') return person.stateId === facility.stateId;
  return person.lgaId === facility.lgaId;
}

interface CandidateQuery {
  facility: Facility;
  need: Pick<Need, 'category' | 'specialty'>;
  start: Date;
  end: Date;
  pool: Practitioner[];
  ranked?: string[];
  exclude?: Set<string>;
}

/**
 * Who a scheduler could realistically offer this shift to: the right
 * profession and specialty, willing to travel there, not already working,
 * and available by their own calendar at the real time of the shift.
 * Anyone the matcher ranked goes first, in its order.
 */
async function candidatesFor(query: CandidateQuery): Promise<Practitioner[]> {
  const matching = query.pool.filter(
    (person) =>
      person.spec.category === query.need.category &&
      (!query.need.specialty || person.spec.specialty === query.need.specialty) &&
      !query.exclude?.has(person.id) &&
      travelOk(person, query.facility) &&
      (!person.workUntil || query.start < person.workUntil) &&
      !person.offWork.some(([from, to]) => query.start < to && query.end > from) &&
      isFree(person.id, query.start, query.end),
  );

  const available: Practitioner[] = [];
  for (const person of shuffle(matching)) {
    const verdict = await availabilityForWindow(person.id, { startsAt: query.start, endsAt: query.end });
    if (verdict.available) available.push(person);
  }

  const rank = new Map((query.ranked ?? []).map((id, position) => [id, position]));
  return available.sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

// --------------------------------------------------------------- shifts

function rateKobo(need: Pick<Need, 'rate'>): number {
  const [low, high] = need.rate;
  const steps = Math.floor((high - low) / 250);
  return (low + between(0, steps) * 250) * 100;
}

function pickUrgency(): 'ROUTINE' | 'URGENT' | 'EMERGENCY' {
  const roll = random();
  if (roll < 0.75) return 'ROUTINE';
  return roll < 0.93 ? 'URGENT' : 'EMERGENCY';
}

async function checkInWithCodes(input: {
  facility: Facility;
  assignmentId: string;
  person: Practitioner;
  checkInAt: Date;
  checkOutAt: Date;
}): Promise<void> {
  const device = DEVICES[Math.abs(input.person.phone.charCodeAt(input.person.phone.length - 1)) % DEVICES.length];
  const inToken = await issueCheckInToken({
    assignmentId: input.assignmentId,
    purpose: 'CHECK_IN',
    actorId: input.facility.scheduler.id,
  });
  // Some scan the QR on the ward tablet, some type the six digits read aloud.
  await presentCheckInToken({
    assignmentId: input.assignmentId,
    purpose: 'CHECK_IN',
    code: chance(0.4) ? inToken.qr : inToken.code,
    userId: input.person.id,
    deviceLabel: device,
    occurredAt: input.checkInAt,
  });
  const outToken = await issueCheckInToken({
    assignmentId: input.assignmentId,
    purpose: 'CHECK_OUT',
    actorId: input.facility.scheduler.id,
  });
  await presentCheckInToken({
    assignmentId: input.assignmentId,
    purpose: 'CHECK_OUT',
    code: chance(0.4) ? outToken.qr : outToken.code,
    userId: input.person.id,
    deviceLabel: device,
    occurredAt: input.checkOutAt,
  });
  await alignCheckInEvents(input.assignmentId, 'live');
}

/**
 * A code presented on the ward is recorded the moment it is presented; a
 * manual entry is recorded hours later from the paper register. Those are
 * different columns precisely so a dispute can tell them apart.
 */
async function alignCheckInEvents(assignmentId: string, kind: 'live' | 'manual'): Promise<void> {
  const record = await prisma.attendanceRecord.findFirstOrThrow({ where: { assignmentId } });
  const events = await prisma.checkInEvent.findMany({ where: { attendanceRecordId: record.id } });
  for (const event of events) {
    await prisma.checkInEvent.update({
      where: { id: event.id },
      data: {
        recordedAt: kind === 'live' ? event.occurredAt : notAfterNow(addHours(event.occurredAt, between(3, 20))),
      },
    });
  }
}

type Plan = 'worked' | 'manual' | 'corrected' | 'no_show' | 'unfilled' | 'cancelled' | 'late_cancel';
type Finish = 'approved' | 'submitted' | 'checked_out';

/**
 * Deterministic by position, so every run has the same mix and each kind of
 * exception is guaranteed to appear rather than left to chance.
 */
function planFor(index: number): Plan {
  if (index % 25 === 3) return 'no_show';
  if (index % 20 === 9) return 'unfilled';
  if (index % 45 === 33) return 'cancelled';
  if (index % 40 === 20) return 'late_cancel';
  if (index % 30 === 11) return 'corrected';
  if (index % 17 === 5) return 'manual';
  return 'worked';
}

interface Stats {
  shifts: number;
  worked: number;
  declined: number;
  noShows: number;
  unfilled: number;
  cancelled: number;
  lateCancelled: number;
  corrected: number;
  awaitingApproval: number;
  awaitingSubmission: number;
}

const stats: Stats = {
  shifts: 0, worked: 0, declined: 0, noShows: 0, unfilled: 0, cancelled: 0,
  lateCancelled: 0, corrected: 0, awaitingApproval: 0, awaitingSubmission: 0,
};

interface HistoricShift {
  facility: Facility;
  need: Need;
  start: Date;
  end: Date;
  plan: Plan;
  finish: Finish;
  pool: Practitioner[];
  ref: Reference;
}

/** Everything that happens to one shift, from a scheduler drafting it to money owed. */
async function workHistoricShift(shift: HistoricShift): Promise<void> {
  const { facility, need, start, end, plan, finish, pool, ref } = shift;
  stats.shifts += 1;

  const urgency = pickUrgency();
  const headcount = need.headcount ? between(need.headcount[0], need.headcount[1]) : 1;
  const liveStart = addHours(new Date(), 2);

  const request = await createServiceRequest({
    facilityId: facility.id,
    professionalCategoryId: ref.categories.get(need.category)!.id,
    specialtyId: need.specialty ? ref.specialties.get(need.specialty) : undefined,
    shiftType: need.shift,
    startsAt: liveStart,
    endsAt: addHours(liveStart, need.hours),
    headcount,
    hourlyRateKobo: rateKobo(need),
    urgency,
    cancellationTerms: pick(CANCELLATION_TERMS),
    notes: `${need.dept}. ${need.notes}`,
    actorId: facility.scheduler.id,
  });
  await publishServiceRequest({ requestId: request.id, facilityId: facility.id, actorId: facility.scheduler.id });

  const createdAt = addHours(start, -(urgency === 'ROUTINE' ? between(72, 240) : between(6, 30)));
  const publishedAt = addMinutes(createdAt, between(10, 90));
  const invitedAt = addMinutes(publishedAt, between(10, 60));
  const respondedAt = addHours(invitedAt, between(1, 5));
  const confirmedAt = addMinutes(respondedAt, between(20, 120));

  const moveRequest = async (extra: { cancelledAt?: Date } = {}) => {
    await prisma.serviceRequest.update({
      where: { id: request.id },
      data: { startsAt: start, endsAt: end, createdAt, publishedAt, ...extra },
    });
  };

  if (plan === 'cancelled') {
    await cancelServiceRequest({
      requestId: request.id,
      facilityId: facility.id,
      actorId: facility.owner.id,
      reason: pick(REQUEST_CANCEL_REASONS),
    });
    await moveRequest({ cancelledAt: addHours(publishedAt, between(4, 30)) });
    stats.cancelled += 1;
    return;
  }

  let matchRunId: string | undefined;
  let ranked: string[] = [];
  if (facility.usesMatching) {
    const run = await runMatch({ requestId: request.id, facilityId: facility.id, actorId: facility.scheduler.id });
    matchRunId = run.id;
    ranked = run.ranked.map((candidate) => candidate.userId);
    await prisma.matchRun.update({ where: { id: run.id }, data: { createdAt: addMinutes(publishedAt, 3) } });
  }

  const candidates = await candidatesFor({ facility, need, start, end, pool, ranked });
  const invitees = candidates.slice(0, headcount + (plan === 'unfilled' ? 1 : 2));

  /**
   * Offered one at a time, down the list, until the places are filled.
   *
   * That is how a scheduler actually works the phone. Offers still out when a
   * shift fills are withdrawn by confirmAssignment, so either way nobody is
   * left holding one; this just keeps the declines to a believable number.
   */
  const acceptors: Practitioner[] = [];
  for (const [position, person] of invitees.entries()) {
    if (acceptors.length >= headcount) break;
    const [invitation] = await invitePractitioners({
      requestId: request.id,
      facilityId: facility.id,
      userIds: [person.id],
      matchRunId,
      actorId: facility.scheduler.id,
    });
    if (plan === 'unfilled' && position === invitees.length - 1) {
      // Never answered. The expiry sweep withdraws it when the shift starts.
    } else if (plan !== 'unfilled' && chance(0.75)) {
      await respondToInvitation({ invitationId: invitation!.id, userId: person.id, decision: 'accept' });
      acceptors.push(person);
    } else {
      await respondToInvitation({
        invitationId: invitation!.id,
        userId: person.id,
        decision: 'decline',
        // Not everyone explains; the ones who do feed the suggestion log.
        reason: chance(0.45) ? pick(DECLINE_REASONS) : undefined,
      });
      stats.declined += 1;
    }
  }

  const assignments: { id: string; person: Practitioner }[] = [];
  for (const person of acceptors) {
    const assignment = await confirmAssignment({
      requestId: request.id,
      facilityId: facility.id,
      userId: person.id,
      actorId: facility.scheduler.id,
    });
    assignments.push({ id: assignment.id, person });
  }

  // A confirmed practitioner drops out and somebody else covers.
  let cancelledAssignmentId: string | null = null;
  if (plan === 'late_cancel' && assignments.length > 0) {
    const dropped = assignments[0]!;
    await cancelAssignment({
      assignmentId: dropped.id,
      facilityId: facility.id,
      actorId: facility.scheduler.id,
      reason: pick(LATE_CANCEL_REASONS),
    });
    cancelledAssignmentId = dropped.id;
    stats.lateCancelled += 1;
    const cover = (
      await candidatesFor({
        facility, need, start, end, pool, ranked,
        exclude: new Set(invitees.map((person) => person.id)),
      })
    )[0];
    assignments.shift();
    if (cover) {
      const [invitation] = await invitePractitioners({
        requestId: request.id,
        facilityId: facility.id,
        userIds: [cover.id],
        matchRunId,
        actorId: facility.scheduler.id,
      });
      await respondToInvitation({ invitationId: invitation!.id, userId: cover.id, decision: 'accept' });
      const covered = await confirmAssignment({
        requestId: request.id,
        facilityId: facility.id,
        userId: cover.id,
        actorId: facility.scheduler.id,
      });
      assignments.push({ id: covered.id, person: cover });
    }
  }

  // Now move all of it to where it belongs in history.
  await moveRequest();
  await prisma.invitation.updateMany({
    where: { serviceRequestId: request.id },
    data: { createdAt: invitedAt, expiresAt: addHours(invitedAt, 24) },
  });
  await prisma.invitation.updateMany({
    where: { serviceRequestId: request.id, respondedAt: { not: null } },
    data: { respondedAt },
  });
  await prisma.assignment.updateMany({
    where: { serviceRequestId: request.id },
    data: { startsAt: start, endsAt: end, createdAt: confirmedAt },
  });
  const assignmentIds = [...assignments.map((row) => row.id), ...(cancelledAssignmentId ? [cancelledAssignmentId] : [])];
  await prisma.assignmentStatusHistory.updateMany({
    where: { assignmentId: { in: assignmentIds }, toStatus: 'CONFIRMED' },
    data: { createdAt: confirmedAt },
  });
  await prisma.assignmentStatusHistory.updateMany({
    where: { assignmentId: { in: assignmentIds }, toStatus: 'CANCELLED' },
    data: { createdAt: addHours(start, -between(3, 6)) },
  });

  if (assignments.length === 0) {
    stats.unfilled += 1;
    return;
  }

  for (const { id: assignmentId, person } of assignments) {
    book(person.id, start, end);

    // The named showcase accounts always turn up; a no-show is somebody else's.
    if (plan === 'no_show' && !person.spec.key) {
      stats.noShows += 1;
      continue;
    }

    const checkInAt = addMinutes(start, between(-15, 12));
    const overran = chance(0.15);
    const checkOutAt = addMinutes(end, overran ? between(30, 95) : between(-5, 15));

    if (plan === 'manual') {
      await recordManualAttendance({
        assignmentId,
        actorId: facility.scheduler.id,
        checkedInAt: checkInAt,
        checkedOutAt: checkOutAt,
        breakMinutes: pick([0, 30, 45, 60]),
        reason: pick(MANUAL_ATTENDANCE_REASONS),
      });
      await alignCheckInEvents(assignmentId, 'manual');
    } else {
      await checkInWithCodes({ facility, assignmentId, person, checkInAt, checkOutAt });
    }

    if (finish === 'checked_out') {
      stats.awaitingSubmission += 1;
      continue;
    }

    await submitTimesheet({ assignmentId, userId: person.id });
    const submittedAt = notAfterNow(addHours(checkOutAt, between(1, 16)));

    if (finish === 'submitted') {
      await prisma.attendanceRecord.updateMany({ where: { assignmentId }, data: { submittedAt } });
      stats.awaitingApproval += 1;
      continue;
    }

    const approver =
      facility.financeOfficer && chance(0.7) ? facility.financeOfficer : facility.owner;

    if (plan === 'corrected') {
      const whichNote = between(0, 1);
      await reviewTimesheet({
        assignmentId,
        facilityId: facility.id,
        actorId: approver.id,
        decision: 'reject',
        reviewNotes: REJECTION_NOTES[whichNote],
      });
      await correctTimesheet({
        assignmentId,
        facilityId: facility.id,
        actorId: facility.scheduler.id,
        ...(whichNote === 0 ? { checkedOutAt: addMinutes(end, 10) } : { breakMinutes: 45 }),
        reason: CORRECTION_REASONS[whichNote]!,
      });
      await submitTimesheet({ assignmentId, userId: person.id });
      stats.corrected += 1;
    }

    await reviewTimesheet({ assignmentId, facilityId: facility.id, actorId: approver.id, decision: 'approve' });
    await prisma.attendanceRecord.updateMany({
      where: { assignmentId },
      data: { submittedAt, reviewedAt: notAfterNow(addHours(submittedAt, between(3, 48))) },
    });
    stats.worked += 1;
  }
}

// --------------------------------------------------------- live shifts

interface LiveShiftInput {
  facility: Facility;
  need: Need;
  start: Date;
  hours?: number;
  headcount?: number;
  urgency?: 'ROUTINE' | 'URGENT' | 'EMERGENCY';
  rate?: [number, number];
  notes?: string;
  ref: Reference;
  publish?: boolean;
  match?: boolean;
  /** The level the shift is for, once its profession has levels (REQ-01). */
  cadreLevelId?: string;
  supervisionAvailable?: boolean;
}

/** A real future shift, published the way a scheduler would, nothing moved. */
async function openShift(input: LiveShiftInput) {
  const hours = input.hours ?? input.need.hours;
  const request = await createServiceRequest({
    facilityId: input.facility.id,
    professionalCategoryId: input.ref.categories.get(input.need.category)!.id,
    specialtyId: input.need.specialty ? input.ref.specialties.get(input.need.specialty) : undefined,
    cadreLevelId: input.cadreLevelId,
    supervisionAvailable: input.supervisionAvailable,
    shiftType: input.need.shift,
    startsAt: input.start,
    endsAt: addHours(input.start, hours),
    headcount: input.headcount ?? 1,
    hourlyRateKobo: rateKobo({ rate: input.rate ?? input.need.rate }),
    urgency: input.urgency ?? 'ROUTINE',
    cancellationTerms: CANCELLATION_TERMS[0]!,
    notes: input.notes ?? `${input.need.dept}. ${input.need.notes}`,
    actorId: input.facility.scheduler.id,
  });
  if (input.publish === false) return { request, matchRunId: undefined, ranked: [] as string[] };

  await publishServiceRequest({ requestId: request.id, facilityId: input.facility.id, actorId: input.facility.scheduler.id });
  if (input.match === false || !input.facility.usesMatching) return { request, matchRunId: undefined, ranked: [] as string[] };

  const run = await runMatch({ requestId: request.id, facilityId: input.facility.id, actorId: input.facility.scheduler.id });
  return { request, matchRunId: run.id, ranked: run.ranked.map((candidate) => candidate.userId) };
}

async function offer(input: {
  facility: Facility;
  requestId: string;
  people: Practitioner[];
  matchRunId?: string;
  expiresInHours?: number;
}) {
  return invitePractitioners({
    requestId: input.requestId,
    facilityId: input.facility.id,
    userIds: input.people.map((person) => person.id),
    matchRunId: input.matchRunId,
    actorId: input.facility.scheduler.id,
    expiresInHours: input.expiresInHours ?? 72,
  });
}

async function acceptAndConfirm(facility: Facility, requestId: string, invitationId: string, person: Practitioner) {
  await respondToInvitation({ invitationId, userId: person.id, decision: 'accept' });
  return confirmAssignment({ requestId, facilityId: facility.id, userId: person.id, actorId: facility.scheduler.id });
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  assertLocal('seed-demo');

  const started = Date.now();
  log('Bringing roles up to date and clearing anything a previous run left…');
  await syncRoles(prisma);
  await clear();
  const ref = await loadReference();
  await ensureDemoRateFloors(ref);

  // ------------------------------------------------------------ platform
  log('Creating platform staff…');
  /**
   * The first administrator is the one account no grant path can create —
   * granting a PLATFORM role is exactly what a PLATFORM role is for. Everyone
   * after them is granted by them, through the same code the console uses,
   * escalation check included.
   */
  const staffJoined = watDay(-400, 9);
  const superAdmin = await makeUser({ ...PLATFORM_STAFF[0], status: 'ACTIVE', joinedAt: staffJoined });
  const superRole = await prisma.role.findUniqueOrThrow({ where: { key: 'super_administrator' } });
  await prisma.userRole.create({
    data: { userId: superAdmin.id, roleId: superRole.id, scopeType: 'PLATFORM', scopeId: null },
  });

  const platform: Record<string, Actor> = { superadmin: superAdmin };
  for (const spec of PLATFORM_STAFF.slice(1)) {
    const actor = await makeUser({ ...spec, status: 'ACTIVE', joinedAt: addDays(staffJoined, between(1, 20)) });
    await grantRole({
      userId: actor.id,
      roleKey: spec.role,
      scopeType: 'PLATFORM',
      actorId: superAdmin.id,
      actorPermissions: SUPER_PERMISSIONS,
    });
    platform[spec.key] = actor;
  }
  const ops = platform.operations!;
  const compliance = platform.compliance!;
  const finance = platform.finance!;

  log('Publishing agreements…');
  const engagementTerms = await publishAgreement({
    kind: 'PRACTITIONER_ENGAGEMENT',
    identifier: `${AGREEMENT_PREFIX}practitioner-engagement-2026`,
    title: 'Practitioner engagement terms, 2026',
    body: ENGAGEMENT_TERMS_BODY,
    effectiveFrom: new Date('2025-10-01T00:00:00.000Z'),
    actorId: compliance.id,
  });
  const facilityTerms = await publishAgreement({
    kind: 'FACILITY_TERMS',
    identifier: `${AGREEMENT_PREFIX}facility-terms-2026`,
    title: 'Facility terms of service, 2026',
    body: FACILITY_TERMS_BODY,
    effectiveFrom: new Date('2025-10-01T00:00:00.000Z'),
    actorId: compliance.id,
  });
  const privacy2025 = await publishAgreement({
    kind: 'PRIVACY_NOTICE',
    identifier: `${AGREEMENT_PREFIX}privacy-notice-2025`,
    title: 'Privacy notice, 2025',
    body: PRIVACY_NOTICE_2025_BODY,
    effectiveFrom: new Date('2025-10-01T00:00:00.000Z'),
    actorId: compliance.id,
  });

  for (const entry of SANCTIONED_ENTRIES) {
    await prisma.sanctionedEntry.create({
      data: { ...entry, normalisedName: normaliseName(entry.fullName), owner: SANCTIONS_OWNER },
    });
  }

  // ---------------------------------------------------------- facilities
  log('Onboarding facilities…');

  async function facilityStaff(fullName: string, phone: string, joinedAt: Date): Promise<Actor> {
    return makeUser({ fullName, phone, status: 'ACTIVE', joinedAt });
  }

  interface FacilitySpec {
    name: string;
    type: string;
    cac: string;
    state: string;
    lga: string;
    address: string;
    licence: string;
    licenceExpires: Date;
    onboardedDaysAgo: number;
    owner: [string, string];
    scheduler?: [string, string];
    administrator?: [string, string];
    financeOfficer?: [string, string];
    decision: 'approve' | 'reject' | 'pending';
    reviewNotes?: string;
    needs: Need[];
    usesMatching: boolean;
    flagship?: boolean;
  }

  const FACILITY_SPECS: FacilitySpec[] = [
    {
      name: 'Aso Garden Specialist Hospital', type: 'private_hospital', cac: `${CAC_PREFIX}1001`,
      state: FCT, lga: 'Abuja Municipal', address: 'Plot 1204 Aminu Kano Crescent, Wuse II, Abuja',
      licence: 'FCT/HHSS/PH/2024/0412', licenceExpires: new Date('2027-03-31T22:59:59.000Z'),
      onboardedDaysAgo: 360, flagship: true, usesMatching: true, decision: 'approve',
      reviewNotes: 'CAC certificate, FCT HHSS operating licence and the Medical Director’s MDCN registration all checked against the originals.',
      owner: ['Ngozi Okonkwo-Bello', phoneFor(11)],
      administrator: ['Chinedu Eze', phoneFor(12)],
      scheduler: ['Hauwa Abdullahi', phoneFor(13)],
      financeOfficer: ['Babatunde Salami', phoneFor(14)],
      needs: FLAGSHIP_NEEDS,
    },
    {
      name: 'Adeola Memorial Hospital', type: 'private_hospital', cac: `${CAC_PREFIX}1002`,
      state: 'LA', lga: 'Ikeja', address: '27 Oba Akran Avenue, Ikeja, Lagos',
      licence: 'LSHFA/PH/2023/1187', licenceExpires: new Date('2026-12-31T22:59:59.000Z'),
      onboardedDaysAgo: 300, usesMatching: false, decision: 'approve',
      reviewNotes: 'Licence confirmed with the Lagos State Health Facility Monitoring and Accreditation Agency.',
      owner: ['Adeola Ogunbiyi', phoneFor(41)],
      scheduler: ['Kemi Adewale', phoneFor(42)],
      needs: LAGOS_NEEDS,
    },
    {
      name: 'Dala Road General Hospital', type: 'general_hospital', cac: `${CAC_PREFIX}1003`,
      state: 'KN', lga: 'Dala', address: 'Dala Road, Kano',
      licence: 'KNSMOH/GH/2022/0093', licenceExpires: new Date('2027-06-30T22:59:59.000Z'),
      onboardedDaysAgo: 280, usesMatching: false, decision: 'approve',
      reviewNotes: 'State Ministry of Health registration confirmed; the Chief Medical Director is the named representative.',
      owner: ['Sani Abubakar Dantata', phoneFor(43)],
      scheduler: ['Rabi Isa', phoneFor(44)],
      needs: KANO_NEEDS,
    },
    {
      name: 'Crystal Diagnostics & Imaging Centre', type: 'imaging_centre', cac: `${CAC_PREFIX}1004`,
      state: 'RI', lga: 'Obio/Akpor', address: '14 Trans-Amadi Road, Port Harcourt',
      licence: 'RSMOH/DC/2026/0211', licenceExpires: new Date('2027-01-31T22:59:59.000Z'),
      onboardedDaysAgo: 4, usesMatching: false, decision: 'pending',
      owner: ['Tamuno Briggs', phoneFor(45)],
      needs: [],
    },
    {
      name: 'Goodlife Clinic', type: 'clinic', cac: `${CAC_PREFIX}1005`,
      state: 'EN', lga: 'Enugu North', address: '3 Ogui Road, Enugu',
      licence: 'ENSMOH/CL/2025/0540', licenceExpires: new Date('2026-11-30T22:59:59.000Z'),
      onboardedDaysAgo: 15, usesMatching: false, decision: 'reject',
      reviewNotes: 'The name on the CAC certificate (Goodlife Health Services Ltd) does not match the operating licence (Good Life Clinic). Resubmit with matching documents or a deed of change of name.',
      owner: ['Chukwudi Anyanwu', phoneFor(46)],
      needs: [],
    },
  ];

  const facilities: Facility[] = [];
  let pendingFacilityName = '';
  let rejectedFacilityName = '';

  for (const spec of FACILITY_SPECS) {
    const onboardedAt = watDay(-spec.onboardedDaysAgo, 10);
    const owner = await facilityStaff(spec.owner[0], spec.owner[1], onboardedAt);
    const stateId = ref.states.get(spec.state)!;
    const facilityLga = lgaId(ref, spec.state, spec.lga);

    // Operations creates the record; the named representative is granted
    // facility_owner over it in the same transaction.
    const facility = await createFacility({
      name: spec.name,
      facilityTypeId: ref.facilityTypes.get(spec.type)!,
      cacNumber: spec.cac,
      stateId,
      lgaId: facilityLga,
      addressLine: spec.address,
      contactPhone: spec.owner[1],
      contactEmail: `admin@${spec.cac.toLowerCase()}.${EMAIL_DOMAIN}`,
      representativeUserId: owner.id,
      licenceNumber: spec.licence,
      licenceExpiresAt: spec.licenceExpires,
      actorId: ops.id,
    });

    // The licence goes up before review: changing it afterwards would send a
    // verified facility straight back to the queue, which is the rule working.
    const licenceUpload = await requestLicenceUploadUrl({
      facilityId: facility.id,
      actorId: owner.id,
      filename: 'operating-licence.pdf',
      contentType: 'application/pdf',
      sizeBytes: PLACEHOLDER_PDF.byteLength,
    });
    await storePlaceholder(licenceUpload.objectKey);
    await updateFacility({ facilityId: facility.id, actorId: owner.id, licenceObjectKey: licenceUpload.objectKey });

    if (spec.decision !== 'pending') {
      await verifyFacility({
        facilityId: facility.id,
        verifierId: compliance.id,
        decision: spec.decision,
        reviewNotes: spec.reviewNotes,
      });
    }
    await prisma.facility.update({
      where: { id: facility.id },
      data: {
        createdAt: onboardedAt,
        ...(spec.decision === 'pending' ? {} : { verifiedAt: addDays(onboardedAt, spec.decision === 'reject' ? 2 : 3) }),
      },
    });

    await acceptAgreement({ userId: owner.id, versionId: facilityTerms.id });
    await prisma.agreementAcceptance.updateMany({ where: { userId: owner.id }, data: { acceptedAt: onboardedAt } });

    if (spec.decision === 'pending') {
      pendingFacilityName = spec.name;
      continue;
    }
    if (spec.decision === 'reject') {
      rejectedFacilityName = spec.name;
      continue;
    }

    const staffJoinedAt = addDays(onboardedAt, 4);
    // The owner adds their own administrator and accounts officer — the
    // escalation check passes because they hold everything those roles do.
    let administrator: Actor | undefined;
    if (spec.administrator) {
      administrator = await facilityStaff(spec.administrator[0], spec.administrator[1], staffJoinedAt);
      await grantRole({
        userId: administrator.id, roleKey: 'facility_administrator', scopeType: 'FACILITY',
        scopeId: facility.id, actorId: owner.id, actorPermissions: OWNER_PERMISSIONS,
      });
    }
    let financeOfficer: Actor | undefined;
    if (spec.financeOfficer) {
      financeOfficer = await facilityStaff(spec.financeOfficer[0], spec.financeOfficer[1], staffJoinedAt);
      await grantRole({
        userId: financeOfficer.id, roleKey: 'facility_administrator', scopeType: 'FACILITY',
        scopeId: facility.id, actorId: owner.id, actorPermissions: OWNER_PERMISSIONS,
      });
    }
    /**
     * The scheduler too, and by the owner rather than by the platform.
     *
     * This is the grant that found the gap: the old facility_scheduler held
     * `availability.read`, facility_owner did not, and grantRole refuses to
     * hand out what the granting actor lacks — so a hospital could not appoint
     * its own scheduler. The permission was added to facility_owner; this is
     * what proves it, because a seed that worked around it would have left the
     * hole open and looked fine.
     *
     * All three of these people now hold `facility_administrator`. That is the
     * merge working rather than a shortcut: a hospital staffs a rota, a
     * cashbook and a front desk with whoever is in that morning, and the three
     * separate roles mostly produced consoles that refused their own sidebar.
     */
    const scheduler = await facilityStaff(spec.scheduler![0], spec.scheduler![1], staffJoinedAt);
    await grantRole({
      userId: scheduler.id, roleKey: 'facility_administrator', scopeType: 'FACILITY',
      scopeId: facility.id, actorId: owner.id, actorPermissions: OWNER_PERMISSIONS,
    });

    facilities.push({
      id: facility.id, name: spec.name, stateId, lgaId: facilityLga, flagship: Boolean(spec.flagship),
      owner, scheduler, administrator, financeOfficer, needs: spec.needs, usesMatching: spec.usesMatching,
    });
    log(`  ${spec.name} — verified`);
  }
  log(`  ${pendingFacilityName} — awaiting verification`);
  log(`  ${rejectedFacilityName} — refused, with reasons`);

  const flagship = facilities.find((facility) => facility.flagship)!;
  const lagos = facilities.find((facility) => facility.name.startsWith('Adeola'))!;
  const kano = facilities.find((facility) => facility.name.startsWith('Dala'))!;

  /**
   * A rate card superseded mid-year, so June's invoice and September's are
   * priced on different terms and the history shows why.
   */
  await createRateCard({
    facilityId: flagship.id, actorId: flagship.owner.id, name: 'Standard premiums, 2026',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    nightMultiplierBp: 12_500, holidayMultiplierBp: 15_000, overtimeMultiplierBp: 10_000,
  });
  await createRateCard({
    facilityId: flagship.id, actorId: flagship.owner.id, name: 'Revised premiums from July 2026',
    effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
    // No on-call multiplier: the validator refuses anything below 1.0x even
    // though pricing.ts describes on-call as paid at a fraction of the rate.
    nightMultiplierBp: 15_000, holidayMultiplierBp: 20_000, overtimeMultiplierBp: 12_500,
  });
  await createRateCard({
    facilityId: lagos.id, actorId: lagos.owner.id, name: 'Night and holiday premiums',
    effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
    nightMultiplierBp: 13_000, holidayMultiplierBp: 17_500,
  });
  await prisma.rateCard.updateMany({
    where: { facilityId: { in: [flagship.id, lagos.id] } },
    data: { createdAt: new Date('2025-12-20T09:00:00.000Z') },
  });
  log('  Aso Garden: 1.25x nights until June, 1.5x nights and 2x holidays from July; Adeola Memorial: 1.3x nights');

  // -------------------------------------------------------- practitioners
  log('Registering and verifying practitioners…');
  const practitioners: Practitioner[] = [];
  for (const [index, spec] of PRACTITIONERS.entries()) {
    practitioners.push(
      await onboard(spec, index, { ref, compliance, engagementTerms: engagementTerms.id, privacyNotice: privacy2025.id }),
    );
  }

  // The name-only match against Zainab Suleiman is a different person, and an
  // officer says so in writing. Emeka Nwosu's folio match stays flagged.
  const zainab = practitioners.find((person) => person.fullName === 'Zainab Suleiman')!;
  await clearScreeningFlag({
    userId: zainab.id,
    actorId: compliance.id,
    notes:
      'Different person: the listed Zainab Suleiman practised in Sokoto under folio MDCN/R/31190. Ours holds MDCN/R/58342, full registration since 2018, confirmed on the MDCN register by phone.',
  });

  const activation = await activateEligiblePractitioners();
  const named = (key: string) => practitioners.find((person) => person.spec.key === key)!;
  const byName = (fullName: string) => practitioners.find((person) => person.fullName === fullName)!;
  log(`  ${practitioners.length} practitioners; the activation sweep cleared ${activation.activated} for work`);

  // Kelechi Umeh stops working twelve days ago, on the shift that ends in his
  // suspension; Joy Okafor sits out the week she was suspended and reinstated.
  const kelechi = named('suspended');
  kelechi.workUntil = watDay(-12, 0);
  const joy = byName('Joy Okafor');
  joy.offWork.push([watDay(-38, 0), watDay(-31, 0)]);

  // The two showcase accounts have their last few days written by hand below.
  const amina = named('practitioner');
  const blessing = named('nurse');
  for (const person of [amina, blessing]) person.offWork.push([watDay(-4, 0), watDay(30, 0)]);

  const historyPool = practitioners.filter(
    (person) => (person.spec.stage ?? 'complete') === 'complete' && person.spec.problem !== 'flagged' && person.spec.problem !== 'name_mismatch',
  );

  // -------------------------------------------------------------- history
  log(`Working ${HISTORY_DAYS / 7} weeks of shifts (this is the long part)…`);

  const holidays = await prisma.publicHoliday.findMany({ select: { date: true, name: true } });
  const holidayKeys = new Set(holidays.map((row) => row.date.toISOString().slice(0, 10)));

  await withSweepsPaused(async () => {
    let index = 0;
    for (let day = -HISTORY_DAYS; day <= -1; day += 1) {
      for (const facility of facilities) {
        for (const need of facility.needs) {
          const start = watDay(day, need.startHour);
          const end = addHours(start, need.hours);
          if (end.getTime() > Date.now() - 2 * HOUR) continue;

          // Democracy Day gets its ward cover whatever the weekday, so the
          // holiday premium shows up on a real invoice line.
          const holidayCover =
            facility.flagship && holidayKeys.has(watDateKey(start)) &&
            (need.dept === 'Medical wards' || need.dept === 'Accident & Emergency');
          const days = need.days ?? EVERY_DAY;
          if (!holidayCover) {
            if (!days.includes(watWeekday(start))) continue;
            if (!chance(need.perWeek / days.length)) continue;
          }

          index += 1;
          const plan = planFor(index);
          // Work from the last four days is still moving through approval.
          const ageHours = (Date.now() - end.getTime()) / HOUR;
          const finish: Finish =
            ageHours > 96 ? 'approved' : (['checked_out', 'submitted', 'submitted', 'approved'] as const)[index % 4]!;

          await workHistoricShift({
            facility, need, start, end,
            plan: finish !== 'approved' && plan === 'corrected' ? 'worked' : plan,
            finish, pool: historyPool, ref,
          });
          if (stats.shifts % 25 === 0) log(`  …${stats.shifts} shifts`);
        }
      }
    }

    // ----------------------------------------------- the recent days, by hand
    // Amina worked A&E two days ago and has not submitted her timesheet yet;
    // Blessing's ICU night three days ago is submitted and waiting for the
    // hospital's approval. Both are the first thing their consoles show.
    const aminaStart = watDay(-2, 8);
    await workNamedShift(flagship, FLAGSHIP_NEEDS[0]!, amina, aminaStart, 12, 'DAY', 'checked_out');
    const blessingStart = watDay(-3, 20);
    await workNamedShift(flagship, FLAGSHIP_NEEDS[5]!, blessing, blessingStart, 12, 'NIGHT', 'submitted');

    // The incident that ends in Kelechi Umeh's suspension has to hang on a
    // shift he worked here: a facility can only name a practitioner it has
    // booked, so a report about somebody it never booked would be refused.
    // The simulation does not always happen to give him one.
    const kelechiWorked = await prisma.assignment.findFirst({
      where: { userId: kelechi.id, facilityId: flagship.id, startsAt: { lt: watDay(-11, 0) } },
    });
    if (!kelechiWorked) {
      await workNamedShift(flagship, FLAGSHIP_NEEDS[3]!, kelechi, watDay(-13, 20), 12, 'NIGHT', 'checked_out');
    }

    log('Closing shifts that started with nobody confirmed…');
    const expired = await expireStartedRequests();
    log(`  ${JSON.stringify(expired)}`);
  });

  /** One of the showcase accounts' recent shifts, written deliberately rather than by chance. */
  async function workNamedShift(
    facility: Facility, need: Need, person: Practitioner, start: Date, hours: number,
    shiftType: 'DAY' | 'NIGHT', finish: Finish,
  ): Promise<void> {
    const end = addHours(start, hours);
    const liveStart = addHours(new Date(), 2);
    const request = await createServiceRequest({
      facilityId: facility.id,
      professionalCategoryId: ref.categories.get(need.category)!.id,
      specialtyId: need.specialty ? ref.specialties.get(need.specialty) : undefined,
      shiftType, startsAt: liveStart, endsAt: addHours(liveStart, hours), headcount: 1,
      hourlyRateKobo: rateKobo({ rate: shiftType === 'DAY' && need.category === 'doctor' ? [7_500, 8_500] : need.rate }),
      urgency: 'URGENT', cancellationTerms: CANCELLATION_TERMS[0]!,
      notes: `${need.dept}. ${need.notes}`, actorId: facility.scheduler.id,
    });
    await publishServiceRequest({ requestId: request.id, facilityId: facility.id, actorId: facility.scheduler.id });
    const run = await runMatch({ requestId: request.id, facilityId: facility.id, actorId: facility.scheduler.id });
    const [invitation] = await offer({ facility, requestId: request.id, people: [person], matchRunId: run.id });
    const assignment = await acceptAndConfirm(facility, request.id, invitation!.id, person);
    const createdAt = addHours(start, -30);
    await prisma.serviceRequest.update({
      where: { id: request.id },
      data: { startsAt: start, endsAt: end, createdAt, publishedAt: addMinutes(createdAt, 15) },
    });
    await prisma.assignment.update({ where: { id: assignment.id }, data: { startsAt: start, endsAt: end, createdAt: addHours(createdAt, 3) } });
    await prisma.invitation.updateMany({
      where: { serviceRequestId: request.id },
      data: { createdAt: addMinutes(createdAt, 30), respondedAt: addHours(createdAt, 2), expiresAt: addHours(createdAt, 24) },
    });
    book(person.id, start, end);
    await checkInWithCodes({
      facility, assignmentId: assignment.id, person,
      checkInAt: addMinutes(start, -8), checkOutAt: addMinutes(end, 22),
    });
    if (finish === 'checked_out') {
      stats.awaitingSubmission += 1;
      return;
    }
    await submitTimesheet({ assignmentId: assignment.id, userId: person.id });
    await prisma.attendanceRecord.updateMany({
      where: { assignmentId: assignment.id },
      data: { submittedAt: addHours(end, 3) },
    });
    stats.awaitingApproval += 1;
  }

  log(
    `  ${stats.shifts} shifts: ${stats.worked} worked and approved, ${stats.awaitingApproval} awaiting approval, ` +
      `${stats.awaitingSubmission} awaiting a timesheet, ${stats.corrected} corrected after rejection, ` +
      `${stats.noShows} never attended, ${stats.lateCancelled} late cancellations covered, ` +
      `${stats.unfilled} unfilled, ${stats.cancelled} cancelled, ${stats.declined} offers declined`,
  );

  // -------------------------------------------------------- unhonoured
  log('Sweeping for shifts nobody attended, and deciding fault…');
  const flagged = await sweepUnhonouredAssignments();
  const awaiting = await listAwaitingFault();
  for (const row of awaiting) {
    const assignment = await prisma.assignment.findUniqueOrThrow({ where: { id: row.assignmentId } });
    await prisma.unhonouredAssignment.update({
      where: { id: row.id },
      data: { detectedAt: addMinutes(assignment.endsAt, between(20, 60)) },
    });
  }

  let decided = 0;
  let excusalsPending = 0;
  for (const [position, row] of awaiting.entries()) {
    const assignment = await prisma.assignment.findUniqueOrThrow({ where: { id: row.assignmentId } });
    const decidedAt = notAfterNow(addDays(assignment.endsAt, between(1, 3)));
    const remaining = awaiting.length - position;

    if (remaining === 1) break; // the newest is left exactly as the sweep found it

    if (remaining === 2) {
      // The practitioner has explained and is waiting on compliance.
      await requestExcusal({
        assignmentId: row.assignmentId,
        userId: row.userId,
        reason:
          'I was admitted to hospital with malaria the evening before and could not call in until the next morning. I can send the discharge summary.',
      });
      excusalsPending += 1;
      break;
    }

    if (position === 0) {
      // Excused properly: asked, granted, and then fault can only be NEITHER.
      const excusal = await requestExcusal({
        assignmentId: row.assignmentId,
        userId: row.userId,
        reason:
          'My car broke down on the Kubwa expressway at 19:10. I called the ward at 19:30 and the nurse in charge noted it in the ward diary.',
      });
      // Granting closes the determination as NEITHER by itself; recording a
      // fault on top of it would be deciding the same case twice.
      await decideExcusal({
        excusalId: excusal.id, actorId: compliance.id, decision: 'grant',
        notes: 'The ward diary confirms the call at 19:30. No fault on either side.',
      });
    } else {
      const fault = position % 3 === 0 ? 'FACILITY' : 'PRACTITIONER';
      await recordFault({
        assignmentId: row.assignmentId, actorId: compliance.id, fault,
        reason:
          fault === 'FACILITY'
            ? 'The ward was closed for fumigation that night; the shift should have been cancelled and was not.'
            : 'No message and no attendance; the ward log shows nobody arrived and calls went unanswered.',
      });
    }
    await prisma.unhonouredAssignment.update({ where: { id: row.id }, data: { decidedAt } });
    decided += 1;
  }
  log(
    `  ${flagged} flagged, ${decided} decided, ${excusalsPending} with an excusal awaiting a decision, ` +
      `${awaiting.length - decided - excusalsPending} untouched`,
  );

  // -------------------------------------------------------------- money
  // Every shift here was booked today and then moved back in time, so the terms
  // fixed at booking are today's. A real booking is priced on what applied when
  // it was made, so the history is given the terms its own date would have had:
  // otherwise June's invoices would carry July's premiums and the superseded
  // card above would never be seen to have priced anything.
  {
    const history = await prisma.assignment.findMany({
      where: { facilityId: { in: facilities.map((f) => f.id) } },
      select: { id: true, facilityId: true, startsAt: true },
    });
    for (const row of history) {
      await prisma.assignment.update({
        where: { id: row.id },
        data: { rateTerms: { ...(await rateTermsFor(row.facilityId, row.startsAt)) } },
      });
    }
  }

  // Where everybody is paid. A payout goes only to an account a finance officer has
  // verified, and has been the practitioner's for a day (BIL-06), so the simulated
  // practitioners each have one, given long ago and verified. These are demo numbers
  // and belong to nobody. Two have given a replacement that is still being checked, one
  // of them in somebody else's name, so the queue and its warnings have something in them.
  log('Giving practitioners somewhere to be paid…');
  {
    const bankNames = ['Guaranty Trust Bank', 'Access Bank', 'First Bank of Nigeria', 'Zenith Bank', 'United Bank for Africa'];
    const longAgo = addDays(new Date(), -120);
    let index = 0;
    for (const person of practitioners) {
      if ((person.spec.stage ?? 'complete') !== 'complete') continue;
      index += 1;
      const number = `0${String(200_000_000 + index * 7_919).padStart(9, '0')}`;
      const held = person.fullName.split(' ').reverse().join(' ').toUpperCase();
      const account = await submitPayoutAccount({
        userId: person.id,
        bankName: bankNames[index % bankNames.length]!,
        accountName: held,
        accountNumber: number,
      });
      await reviewPayoutAccount({ accountId: account.id, actorId: finance.id, decision: 'verify' });
      await prisma.payoutAccount.update({ where: { id: account.id }, data: { createdAt: longAgo, reviewedAt: addDays(longAgo, 1) } });
    }
    const replacements = practitioners.filter((person) => (person.spec.stage ?? 'complete') === 'complete').slice(3, 5);
    for (const [position, person] of replacements.entries()) {
      await submitPayoutAccount({
        userId: person.id,
        bankName: 'Access Bank',
        // The second is in a relative's name, which is what the check is for.
        accountName: position === 0 ? person.fullName.split(' ').reverse().join(' ').toUpperCase() : 'ADEYEMI FUNMILAYO',
        accountNumber: `0${String(900_000_000 + position * 4_013).padStart(9, '0')}`,
      });
    }
    log(`  ${index} accounts verified; ${replacements.length} replacements waiting for a check`);
  }

  log('Invoicing, paying and settling month by month…');

  const firstMonth = new Date(watDay(-HISTORY_DAYS).getTime() + WAT);
  const thisMonth = new Date(Date.now() + WAT);
  const months: { start: Date; end: Date; age: number }[] = [];
  for (
    let cursor = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth(), 1));
    cursor.getTime() <= Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth(), 1);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  ) {
    const age =
      (thisMonth.getUTCFullYear() - cursor.getUTCFullYear()) * 12 + thisMonth.getUTCMonth() - cursor.getUTCMonth();
    months.push({
      start: new Date(cursor.getTime() - WAT),
      end: new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1) - WAT),
      age,
    });
  }

  let raised = 0;
  let paid = 0;
  let released = 0;
  let prepared = 0;

  for (const month of months) {
    let latestPayment: Date | null = null;

    for (const facility of facilities) {
      let invoice;
      try {
        invoice = await generateInvoice({
          facilityId: facility.id, periodStart: month.start, periodEnd: month.end, actorId: finance.id,
        });
      } catch {
        continue; // nothing approved in that month for that facility
      }
      raised += 1;
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { createdAt: notAfterNow(addDays(month.end, 1)) },
      });

      // This month's stays a draft; every earlier one is issued.
      if (month.age === 0) continue;
      const issuedAt = addDays(month.end, 2);
      const issueMark = new Date(Date.now() - 1000);
      await issueInvoice({ invoiceId: invoice.id, actorId: finance.id });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { issuedAt } });
      await prisma.ledgerEntry.updateMany({
        where: { invoiceId: invoice.id, createdAt: { gte: issueMark } },
        data: { createdAt: issuedAt },
      });

      // Last month's is inside its payment terms. Kano is a month behind.
      const unpaid = month.age === 1 || (facility === kano && month.age === 2);
      if (unpaid) continue;
      const paidAt = addDays(issuedAt, between(9, 24));
      const payMark = new Date(Date.now() - 1000);
      await recordPayment({
        invoiceId: invoice.id,
        actorId: finance.id,
        reference: `DEMO-TRF-${invoice.number}`,
        amountKobo: invoice.grossKobo,
        paidOn: lagosDate(paidAt),
        payerName: facility.name,
      });
      await prisma.invoice.update({ where: { id: invoice.id }, data: { paidAt } });
      await prisma.ledgerEntry.updateMany({
        where: { invoiceId: invoice.id, createdAt: { gte: payMark } },
        data: { createdAt: paidAt },
      });
      paid += 1;
      if (!latestPayment || paidAt > latestPayment) latestPayment = paidAt;
    }

    if (!latestPayment) continue;

    // A payout run a few days after the money arrives. The most recent run is
    // only half released, so the two-step nature of it shows.
    const lastRun = months.filter((m) => m.age >= 2).at(-1) === month;
    const runAt = notAfterNow(addDays(latestPayment, 3));
    for (const person of practitioners) {
      if ((await amountOwed(person.id)) <= 0) continue;
      let payout;
      try {
        payout = await preparePayout({ practitionerId: person.id, actorId: finance.id });
      } catch {
        continue; // everything owed is already in flight
      }
      prepared += 1;
      await prisma.payout.update({ where: { id: payout.id }, data: { createdAt: runAt } });
      if (lastRun && chance(0.4)) continue;
      const releaseMark = new Date(Date.now() - 1000);
      // Somebody other than the person who prepared it: a payout cannot be released by
      // its own preparer (UXO-03), and the demo should show the rule as it works.
      await releasePayout({ payoutId: payout.id, actorId: superAdmin.id });
      const releasedAt = notAfterNow(addDays(runAt, 1));
      await prisma.payout.update({ where: { id: payout.id }, data: { releasedAt } });
      await prisma.ledgerEntry.updateMany({
        where: { payoutId: payout.id, createdAt: { gte: releaseMark } },
        data: { createdAt: releasedAt },
      });
      released += 1;
    }
  }
  log(`  ${raised} invoices raised, ${paid} paid; ${prepared} payouts prepared, ${released} released`);

  // ---------------------------------------------------------- incidents
  log('Reporting and working clinical incidents…');

  /**
   * One shift really worked at the flagship before `before`, and whoever
   * worked it.
   *
   * The incidents below used to name a practitioner each and look that person
   * up. When the simulation had not happened to book them — Joy Okafor drew
   * no shifts at all on one run, Chidi Okafor's fell outside the window — the
   * `if (shift)` guarding each block quietly did nothing: two of the seven
   * incidents never existed, the suspension-and-reinstatement story went with
   * them, and the summary line announced seven regardless. Nothing failed,
   * which is what made it hard to see.
   *
   * So the subject is read back from the shifts that were actually worked,
   * preferring the named practitioner when they did work one, and refusing
   * loudly when there is nobody at all.
   */
  const incidentSubjects: string[] = [];
  // The accounts on the login sheet keep the stories written for them, so an
  // unclaimed incident falls to somebody from the pool instead.
  const showcaseIds = practitioners.filter((person) => person.spec.key).map((person) => person.id);

  async function workedShiftBefore(before: Date, prefer?: Practitioner) {
    const preferred = prefer
      ? await prisma.assignment.findFirst({
          where: {
            userId: prefer.id,
            facilityId: flagship.id,
            endsAt: { lt: before },
            attendance: { isNot: null },
          },
          orderBy: { startsAt: 'desc' },
        })
      : null;

    const row =
      preferred ??
      (await prisma.assignment.findFirst({
        where: {
          facilityId: flagship.id,
          endsAt: { lt: before },
          attendance: { isNot: null },
          userId: { notIn: [...incidentSubjects, ...showcaseIds] },
        },
        orderBy: { startsAt: 'desc' },
      }));

    if (!row) throw new Error(`No shift was worked at the flagship before ${before.toISOString()}.`);

    incidentSubjects.push(row.userId);
    return { shift: row, subject: practitioners.find((person) => person.id === row.userId)! };
  }

  async function backdateIncident(id: string, reportedAt: Date, closedAt?: Date) {
    await prisma.clinicalIncident.update({
      where: { id },
      data: { reportedAt, createdAt: reportedAt, ...(closedAt ? { closedAt } : {}) },
    });
  }

  // Reported, the practitioner suspended while it is looked at, found to be a
  // storage fault rather than their error, and reinstated. Both the suspension
  // and the lifting of it stay on the record afterwards, which is the point:
  // an account that was suspended and cleared must not read the same as one
  // that was never suspended.
  {
    const { shift: joyShift, subject: joySubject } = await workedShiftBefore(watDay(-38, 0), joy);
    const occurredAt = addHours(joyShift.startsAt, 5);
    const incident = await reportIncident({
      facilityId: flagship.id, actorId: flagship.owner.id, assignmentId: joyShift.id,
      subjectUserId: joySubject.id, occurredAt,
      severity: 'MINOR', category: 'MEDICATION',
      summary:
        'Soluble insulin 100 units/ml given where the chart specified 40 units/ml strength. Blood glucose monitored hourly; the patient came to no harm. The two vials are near-identical and stored side by side.',
    });
    await beginIncidentReview({ incidentId: incident.id, actorId: compliance.id });
    await suspendAccount({
      userId: joySubject.id, actorId: compliance.id, incidentId: incident.id,
      reason: 'Suspended from shifts pending review of a medication incident at Aso Garden Specialist Hospital.',
    });
    await closeIncident({
      incidentId: incident.id, actorId: compliance.id, outcome: 'SYSTEM_ISSUE',
      notes:
        'Look-alike insulin strengths stored in adjacent bins with identical labels. Pharmacy has separated and re-labelled them. Not a practitioner error.',
    });
    await reinstateAccount({
      userId: joySubject.id, actorId: compliance.id,
      reason: 'Review found a storage and labelling fault, not a practitioner error. Reinstated with an apology.',
    });
    await backdateIncident(incident.id, addHours(occurredAt, 3), addDays(occurredAt, 6));
    await prisma.accountSuspension.updateMany({
      where: { userId: joySubject.id },
      data: { suspendedAt: addDays(occurredAt, 1), createdAt: addDays(occurredAt, 1), liftedAt: addDays(occurredAt, 7) },
    });
  }

  // Kelechi Umeh by name rather than by whoever happened to work: the login
  // sheet promises a suspended practitioner, and a suspension has to have a
  // case behind it. He is given a shift at the flagship above if the
  // simulation did not, so the case hangs on one; with no shift it would still
  // be filed against him as the subject, but only because he has been booked
  // there.
  {
    const kelechiShift = await prisma.assignment.findFirst({
      where: {
        userId: kelechi.id,
        facilityId: flagship.id,
        endsAt: { lt: watDay(-11, 0) },
        attendance: { isNot: null },
      },
      orderBy: { startsAt: 'desc' },
    });
    const occurredAt = kelechiShift ? addHours(kelechiShift.startsAt, 7) : watDay(-13, 21);
    const incident = await reportIncident({
      facilityId: flagship.id, actorId: flagship.owner.id, assignmentId: kelechiShift?.id,
      subjectUserId: kelechi.id, occurredAt,
      severity: 'SEVERE', category: 'CLINICAL_PROCEDURE',
      summary:
        'Assisted vaginal delivery performed without documented consent and without informing the on-call consultant. The baby needed resuscitation and was transferred to SCBU; the doctor left before the post-delivery review.',
    });
    await beginIncidentReview({ incidentId: incident.id, actorId: compliance.id });
    await closeIncident({
      incidentId: incident.id, actorId: compliance.id, outcome: 'PRACTITIONER_SUSPENDED',
      notes:
        'Statements from the midwife in charge and the consultant, and the partograph, confirm the account. Suspended from the platform; the facility has been advised to refer the matter to MDCN.',
    });
    await backdateIncident(incident.id, addHours(occurredAt, 2), addDays(occurredAt, 4));
    await prisma.accountSuspension.updateMany({
      where: { userId: kelechi.id },
      data: { suspendedAt: addDays(occurredAt, 4), createdAt: addDays(occurredAt, 4) },
    });
  }

  // A documentation slip, closed with training.
  const chidi = byName('Chidi Okafor');
  {
    const { shift: chidiShift, subject: chidiSubject } = await workedShiftBefore(watDay(-18, 0), chidi);
    const occurredAt = addHours(chidiShift.startsAt, 9);
    const incident = await reportIncident({
      facilityId: flagship.id, actorId: flagship.owner.id, assignmentId: chidiShift.id,
      subjectUserId: chidiSubject.id, occurredAt,
      severity: 'MINOR', category: 'DOCUMENTATION',
      summary:
        'Handover notes for two patients in adjacent beds were filed against the wrong records. Found at the next drug round and corrected; no treatment was given on the wrong notes.',
    });
    await beginIncidentReview({ incidentId: incident.id, actorId: compliance.id });
    await closeIncident({
      incidentId: incident.id, actorId: compliance.id, outcome: 'TRAINING_REQUIRED',
      notes: 'Discussed with the practitioner; asked to complete the hospital’s patient-identification refresher before the next shift.',
    });
    await backdateIncident(incident.id, addHours(occurredAt, 4), addDays(occurredAt, 5));
  }

  // Equipment: closed with no action against anyone.
  {
    const occurredAt = watDay(-26, 3, 40);
    const incident = await reportIncident({
      facilityId: flagship.id, actorId: flagship.owner.id, occurredAt, severity: 'NEAR_MISS', category: 'EQUIPMENT',
      summary:
        'ICU infusion pump alarmed and could not be silenced during a noradrenaline infusion; a spare was brought from theatre within four minutes. The pump was two months past its service date.',
    });
    await beginIncidentReview({ incidentId: incident.id, actorId: compliance.id });
    await closeIncident({
      incidentId: incident.id, actorId: compliance.id, outcome: 'NO_ACTION',
      notes: 'Biomedical engineering has serviced all ICU pumps and added them to a quarterly schedule. Nothing for the platform to act on.',
    });
    await backdateIncident(incident.id, addHours(occurredAt, 5), addDays(occurredAt, 3));
  }

  // Under review: a staffing problem, not a person.
  {
    const occurredAt = watDay(-6, 2, 15);
    const incident = await reportIncident({
      facilityId: flagship.id, actorId: flagship.owner.id, occurredAt, severity: 'MODERATE', category: 'STAFFING',
      summary:
        'ICU ran one nurse short overnight after a late cancellation. Two-hourly observations on bed 6 were forty minutes late and the patient’s deterioration was picked up late; transferred to theatre at 04:00.',
    });
    await beginIncidentReview({ incidentId: incident.id, actorId: compliance.id });
    await backdateIncident(incident.id, addHours(occurredAt, 6));
  }

  // New, untouched, in the compliance queue.
  {
    const occurredAt = watDay(-1, 22, 30);
    const incident = await reportIncident({
      facilityId: flagship.id, actorId: flagship.owner.id, occurredAt, severity: 'NEAR_MISS', category: 'MEDICATION',
      summary:
        'Wrong strength of insulin drawn up and caught by the second checker before it reached the patient — the same look-alike vials as last month’s incident, on a different ward.',
    });
    await backdateIncident(incident.id, notAfterNow(addHours(occurredAt, 2)));
  }
  {
    const occurredAt = watDay(-3, 11, 0);
    const incident = await reportIncident({
      facilityId: lagos.id, actorId: lagos.owner.id, occurredAt, severity: 'MINOR', category: 'INFECTION_CONTROL',
      summary:
        'Sharps bin on the female surgical ward overfilled and a needle was found protruding. No injury. The bins are collected twice a week and should be daily.',
    });
    await backdateIncident(incident.id, addHours(occurredAt, 3));
  }
  // Counted back out of the database rather than written down here. The line
  // this replaces was a sentence, not a count, and it went on claiming seven
  // incidents for as long as only five were being made.
  const [newIncidents, reviewing, closedIncidents, suspended, lifted] = await Promise.all([
    prisma.clinicalIncident.count({ where: { status: 'REPORTED' } }),
    prisma.clinicalIncident.count({ where: { status: 'UNDER_REVIEW' } }),
    prisma.clinicalIncident.count({ where: { status: 'CLOSED' } }),
    prisma.accountSuspension.count(),
    prisma.accountSuspension.count({ where: { liftedAt: { not: null } } }),
  ]);
  log(
    `  ${newIncidents + reviewing + closedIncidents} incidents: ${newIncidents} new, ${reviewing} under review, ` +
      `${closedIncidents} closed; ${suspended} suspensions of which ${lifted} lifted and ${suspended - lifted} standing`,
  );

  // ---------------------------------------------------- licence lapses
  // Rukayat Adebisi's NMCN licence ran out on the date in her spec; moving
  // the date is the whole edit, and the sweep does the rest.
  const lapsed = named('registrationLapsed');
  await prisma.professionalRegistration.updateMany({
    where: { userId: lapsed.id },
    data: { expiresAt: lapsed.spec.registrationExpires },
  });
  const credentialExpiry = await expireCredentials();
  const registrationExpiry = await expireRegistrations();
  log(`  licence sweeps: ${JSON.stringify(credentialExpiry)} ${JSON.stringify(registrationExpiry)}`);

  // ------------------------------------------------------------ disputes
  log('Raising and working disputes…');
  const disputable = await prisma.attendanceRecord.findMany({
    where: {
      status: 'APPROVED',
      reviewedAt: { gte: addDays(new Date(), -12) },
      assignment: { facilityId: flagship.id },
    },
    include: { assignment: true },
    orderBy: { reviewedAt: 'asc' },
  });

  const DISPUTES = [
    {
      category: 'HOURS' as const, by: 'practitioner' as const, then: 'open_with_evidence' as const,
      reason: 'My check-out shows the scheduled end, but I stayed until 09:40 to escort a ventilated patient to National Hospital. The ambulance log and the ICU charge nurse can confirm.',
    },
    {
      category: 'PAY' as const, by: 'practitioner' as const, then: 'under_review' as const,
      reason: 'The rate on my timesheet is lower than the one on the offer I accepted — the shift was advertised as urgent with a higher rate that evening.',
    },
    {
      category: 'HOURS' as const, by: 'practitioner' as const, then: 'upheld' as const,
      reason: 'Approved hours are short by ninety minutes: the day registrar was held in theatre and I stayed until they arrived.',
    },
    {
      category: 'PAY' as const, by: 'practitioner' as const, then: 'dismissed' as const,
      reason: 'I was told there is a transport allowance for night shifts ending after 06:00 and it is not on my timesheet.',
    },
    {
      category: 'HOURS' as const, by: 'practitioner' as const, then: 'withdrawn' as const,
      reason: 'A 60-minute break has been recorded; I only took thirty minutes because A&E was full all night.',
    },
    {
      category: 'CONDUCT' as const, by: 'facility' as const, then: 'open' as const,
      reason: 'The practitioner left the ward at 06:30 without handing over to the incoming doctor. Two patients’ morning bloods were not requested and one drug chart was left unsigned.',
    },
  ];

  let disputes = 0;
  const usedPeople = new Set<string>();
  const candidatesForDispute = disputable.filter((row) => {
    if (usedPeople.has(row.assignment.userId)) return false;
    usedPeople.add(row.assignment.userId);
    return true;
  });
  if (candidatesForDispute.length < DISPUTES.length) {
    // Refused rather than trimmed. The summary below names every status a
    // dispute can be in, and a run that quietly placed four of the six would
    // still print that sentence — the same way the incident tally used to
    // claim seven when five existed. If the simulation cannot produce enough
    // recently-approved shifts to argue about, that is worth knowing.
    throw new Error(
      `Only ${candidatesForDispute.length} recently-approved shifts are available to dispute; ${DISPUTES.length} are needed.`,
    );
  }
  for (const [position, spec] of DISPUTES.entries()) {
    const row = candidatesForDispute[position]!;
    const assignment = row.assignment;
    const raisedBy = spec.by === 'facility' ? flagship.owner.id : assignment.userId;
    const dispute = await raiseDispute({
      assignmentId: assignment.id,
      actorId: raisedBy,
      facilityId: spec.by === 'facility' ? flagship.id : undefined,
      category: spec.category,
      reason: spec.reason,
    });
    const raisedAt = notAfterNow(addHours(row.reviewedAt!, between(6, 40)));
    let closedAt: Date | undefined;

    if (spec.then === 'open_with_evidence') {
      const upload = await requestEvidenceUploadUrl({
        disputeId: dispute.id, userId: raisedBy, filename: 'ambulance-transfer-log.pdf',
        contentType: 'application/pdf', sizeBytes: PLACEHOLDER_PDF.byteLength,
      });
      await storePlaceholder(upload.objectKey);
      await attachEvidence({
        disputeId: dispute.id, userId: raisedBy, objectKey: upload.objectKey,
        note: 'Ambulance transfer log, countersigned by the ICU charge nurse.',
      });
    }
    if (spec.then === 'under_review' || spec.then === 'upheld' || spec.then === 'dismissed') {
      await beginReview({ disputeId: dispute.id, actorId: ops.id });
    }
    if (spec.then === 'upheld') {
      await resolveDispute({
        disputeId: dispute.id, actorId: ops.id, outcome: 'UPHELD', decisionReason: 'RECORD_WAS_WRONG',
        notes: 'The theatre log and the ward handover sheet both show the practitioner stayed ninety minutes past the scheduled end. The facility has agreed to pay the difference on the next invoice.',
      });
      closedAt = notAfterNow(addDays(raisedAt, 2));
    }
    if (spec.then === 'dismissed') {
      await resolveDispute({
        disputeId: dispute.id, actorId: ops.id, outcome: 'DISMISSED', decisionReason: 'COMPLAINT_NOT_MADE_OUT',
        notes: 'Neither the published shift nor the facility’s rate card includes a transport allowance, and the offer accepted showed none. Dismissed.',
      });
      closedAt = notAfterNow(addDays(raisedAt, 3));
    }
    if (spec.then === 'withdrawn') {
      await withdrawDispute({ disputeId: dispute.id, actorId: raisedBy });
      closedAt = notAfterNow(addHours(raisedAt, 20));
    }
    await prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        createdAt: raisedAt,
        // The reply is asked for by the same window it would have been had it been raised then.
        respondBy: addDays(raisedAt, DISPUTE_RESPONSE_DAYS),
        ...(spec.then === 'withdrawn' ? { withdrawnAt: closedAt } : closedAt ? { resolvedAt: closedAt } : {}),
      },
    });
    disputes += 1;
  }
  log(`  ${disputes} disputes: open, under review, upheld, dismissed, withdrawn, and one raised by the hospital`);

  // --------------------------------------------------------- suggestions
  log('Filling and triaging the suggestion log…');
  const SUGGESTIONS = [
    { from: amina, area: 'PAYMENTS' as const, body: 'Please show the total I will be paid for a shift, including the night premium, before I accept it.', status: null, response: undefined, daysAgo: 2 },
    { from: blessing, area: 'ATTENDANCE' as const, body: 'The check-in code expires before the ward clerk finishes reading it out during a busy handover.', status: null, response: undefined, daysAgo: 5 },
    { from: byName('Segun Balogun'), area: 'MATCHING' as const, body: 'I keep being offered weekday day shifts although my calendar says weekends and nights only.', status: 'TRIAGED' as const, response: undefined, daysAgo: 16 },
    { from: byName('Fatima Bello'), area: 'CREDENTIALS' as const, body: 'Let me upload a renewed licence before the old one expires, so there is no gap in which I cannot be booked.', status: 'PLANNED' as const, response: 'Agreed — renewal uploads are planned for the next release.', daysAgo: 28 },
    { from: byName('Hadiza Musa'), area: 'ONBOARDING' as const, body: 'Nothing told me which credentials were still missing until I was refused work.', status: 'DONE' as const, response: 'Your profile page now lists every outstanding requirement and why each one blocks matching. Thank you for raising it.', daysAgo: 60 },
    { from: byName('Obinna Eze'), area: 'SCHEDULING' as const, body: 'Let practitioners swap confirmed shifts between themselves without going through the hospital.', status: 'DECLINED' as const, response: 'Declined for now: the hospital has to confirm who is on its ward, for patient safety and for its own records. A swap request the hospital approves is under consideration.', daysAgo: 45 },
    { from: flagship.owner, area: 'MATCHING' as const, body: 'Show us how many shifts a locum has completed with other hospitals before we confirm them, not just with us.', status: null, response: undefined, daysAgo: 7 },
    { from: lagos.owner, area: 'PAYMENTS' as const, body: 'We would like invoices fortnightly rather than monthly; our cash flow is weekly.', status: 'TRIAGED' as const, response: undefined, daysAgo: 20 },
  ];
  for (const spec of SUGGESTIONS) {
    const suggestion = await submitSuggestion({ userId: spec.from.id, area: spec.area, body: spec.body });
    const createdAt = watDay(-spec.daysAgo, between(8, 20));
    if (spec.status) {
      await triageSuggestion({ suggestionId: suggestion.id, actorId: ops.id, status: spec.status, response: spec.response });
    }
    await prisma.suggestion.update({
      where: { id: suggestion.id },
      data: { createdAt, ...(spec.status ? { triagedAt: notAfterNow(addDays(createdAt, between(1, 4))) } : {}) },
    });
  }
  const declineSuggestions = await prisma.suggestion.count({ where: { source: 'DECLINE_REASON' } });
  log(`  ${SUGGESTIONS.length} written suggestions across every status, plus ${declineSuggestions} from decline reasons`);

  // -------------------------------------------------- data subject rights
  log('Raising data-subject requests…');
  const DATA_REQUESTS = [
    { person: chidi, kind: 'ACCESS' as const, detail: 'A copy of everything Medilink holds about me, please.', daysAgo: 24, close: { status: 'COMPLETED' as const, outcome: 'Export generated and sent to the registered phone number as a password-protected file.', afterDays: 6 } },
    { person: byName('Hadiza Musa'), kind: 'PORTABILITY' as const, detail: 'My work history in a format I can give another agency.', daysAgo: 40, close: { status: 'COMPLETED' as const, outcome: 'Work history and verified credentials exported as JSON and PDF.', afterDays: 9 } },
    { person: byName('Segun Balogun'), kind: 'RESTRICTION' as const, detail: 'Stop processing my credentials while I decide whether to stay.', daysAgo: 33, close: { status: 'REFUSED' as const, outcome: 'Credential processing is needed to keep you on the register of eligible practitioners and is required by law. You can pause availability or close the account instead.', afterDays: 5 } },
    { person: named('nameMismatch'), kind: 'RECTIFICATION' as const, detail: 'My legal name is Samaila Garba, as on my NIN. Please correct the name on my account.', daysAgo: 4, close: null },
    { person: named('registrationLapsed'), kind: 'ERASURE' as const, detail: 'I have moved abroad and want my data removed.', daysAgo: 8, close: null },
  ];
  for (const spec of DATA_REQUESTS) {
    const request = await raiseRequest({ userId: spec.person.id, kind: spec.kind, detail: spec.detail });
    if (spec.close) {
      await closeRequest({ requestId: request.id, actorId: compliance.id, status: spec.close.status, outcome: spec.close.outcome });
    }
    const row = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: request.id } });
    const receivedAt = watDay(-spec.daysAgo, between(9, 17));
    const shift = receivedAt.getTime() - row.receivedAt.getTime();
    await prisma.dataSubjectRequest.update({
      where: { id: request.id },
      data: {
        receivedAt,
        dueBy: new Date(row.dueBy.getTime() + shift),
        ...(spec.close ? { completedAt: addDays(receivedAt, spec.close.afterDays) } : {}),
      },
    });
  }
  // Opted in to marketing, then changed her mind.
  await recordConsent({ userId: blessing.id, purpose: 'MARKETING', granted: true, actorId: blessing.id });
  await recordConsent({
    userId: blessing.id, purpose: 'MARKETING', granted: false,
    note: 'Getting more messages than I want; would rather not.', actorId: blessing.id,
  });
  log(`  ${DATA_REQUESTS.length} requests: 2 completed, 1 refused, 2 open (one erasure with real blockers)`);

  // ---------------------------------------------------------- the future
  log('Publishing live and upcoming work…');

  // Leave booked well ahead — the matcher reports these as "blocked", which
  // is a different answer from "does not work that day".
  await addBlock({ userId: amina.id, startsAt: watDay(14, 0), endsAt: watDay(21, 0), reason: 'Annual leave — family visit to Kaduna.' });
  const nkechi = byName('Nkechi Obiora');
  await addBlock({ userId: nkechi.id, startsAt: watDay(1, 0), endsAt: watDay(8, 0), reason: 'Family wedding in Enugu.' });

  const livePool = [] as Practitioner[];
  for (const person of practitioners) {
    if ((await getEligibility(person.id)).eligible) livePool.push(person);
  }
  // The future starts clean: history's bookings are all in the past, but the
  // showcase accounts' reservations have served their purpose.
  for (const person of [amina, blessing]) person.offWork = [];

  const [aeNight, wardDay, paeds, labourDoctor, theatre, icu, midwife, pharmacy, lab, radiology] = FLAGSHIP_NEEDS as [
    Need, Need, Need, Need, Need, Need, Need, Need, Need, Need,
  ];

  /** Confirmed ahead of time, the ordinary way: match, offer, accept, confirm. */
  async function confirmedAhead(facility: Facility, need: Need, start: Date, preferred?: Practitioner) {
    const end = addHours(start, need.hours);
    const { request, matchRunId, ranked } = await openShift({ facility, need, start, ref });
    const people = preferred
      ? [preferred]
      : (await candidatesFor({ facility, need, start, end, pool: livePool, ranked })).slice(0, 2);
    if (people.length === 0) return null;
    const invitations = await offer({ facility, requestId: request.id, people, matchRunId });
    const chosen = people[0]!;
    // Filling the last place withdraws the remaining open invitations.
    if (invitations[1]) {
      await respondToInvitation({ invitationId: invitations[1].id, userId: people[1]!.id, decision: 'decline', reason: pick(DECLINE_REASONS) });
    }
    const assignment = await acceptAndConfirm(facility, request.id, invitations[0]!.id, chosen);
    book(chosen.id, start, end);
    return { request, assignment, person: chosen };
  }

  /** A shift is a night shift when most of it falls after dark. */
  const isDayStart = (at: Date) => watHour(at) >= 6 && watHour(at) < 15;

  // Amina's eight-hour shift, in progress right now: checked in by QR three
  // hours ago. The scheduler issues her check-out code at handover.
  const liveStart = new Date(Math.floor((Date.now() - 3 * HOUR) / HOUR) * HOUR);
  const liveHours = 8;
  const liveIsDay = isDayStart(liveStart);
  const liveNeed: Need = { ...aeNight, shift: liveIsDay ? 'DAY' : 'NIGHT', rate: liveIsDay ? [7_500, 8_500] : aeNight.rate };
  {
    const request = await createServiceRequest({
      facilityId: flagship.id,
      professionalCategoryId: ref.categories.get('doctor')!.id,
      specialtyId: ref.specialties.get('emergency_medicine'),
      shiftType: liveNeed.shift,
      startsAt: addHours(new Date(), 2),
      endsAt: addHours(new Date(), 2 + liveHours),
      headcount: 1,
      hourlyRateKobo: rateKobo(liveNeed),
      urgency: 'URGENT',
      cancellationTerms: CANCELLATION_TERMS[0]!,
      notes: `Accident & Emergency. ${aeNight.notes}`,
      actorId: flagship.scheduler.id,
    });
    await publishServiceRequest({ requestId: request.id, facilityId: flagship.id, actorId: flagship.scheduler.id });
    const run = await runMatch({ requestId: request.id, facilityId: flagship.id, actorId: flagship.scheduler.id });
    const [invitation] = await offer({ facility: flagship, requestId: request.id, people: [amina], matchRunId: run.id });
    const assignment = await acceptAndConfirm(flagship, request.id, invitation!.id, amina);
    const liveEnd = addHours(liveStart, liveHours);
    const createdAt = addHours(liveStart, -20);
    await prisma.serviceRequest.update({ where: { id: request.id }, data: { startsAt: liveStart, endsAt: liveEnd, createdAt, publishedAt: addMinutes(createdAt, 10) } });
    await prisma.assignment.update({ where: { id: assignment.id }, data: { startsAt: liveStart, endsAt: liveEnd, createdAt: addHours(createdAt, 2) } });
    await prisma.invitation.updateMany({ where: { serviceRequestId: request.id }, data: { createdAt: addMinutes(createdAt, 20), respondedAt: addHours(createdAt, 1) } });
    const token = await issueCheckInToken({ assignmentId: assignment.id, purpose: 'CHECK_IN', actorId: flagship.scheduler.id });
    await presentCheckInToken({
      assignmentId: assignment.id, purpose: 'CHECK_IN', code: token.qr, userId: amina.id,
      deviceLabel: 'iPhone 13', occurredAt: addMinutes(liveStart, 6),
    });
    await alignCheckInEvents(assignment.id, 'live');
    book(amina.id, liveStart, liveEnd);
  }

  // Blessing's ICU shift starts within the hour; nobody has checked in yet.
  const soonStart = new Date(Math.ceil((Date.now() + 45 * MINUTE) / (15 * MINUTE)) * 15 * MINUTE);
  const soonIsDay = isDayStart(soonStart);
  await confirmedAhead(
    flagship,
    { ...icu, shift: soonIsDay ? 'DAY' : 'NIGHT', rate: soonIsDay ? [3_200, 3_800] : icu.rate },
    soonStart,
    blessing,
  );

  // Upcoming confirmed work for both, and for the rota generally.
  for (const offset of [2, 5, 9]) await confirmedAhead(flagship, aeNight, watDay(offset, 20), amina);
  await confirmedAhead(flagship, icu, watDay(6, 20), blessing);
  // Day 1 onwards here and day 4 onwards for the acceptance below, so the two
  // paediatric shifts can never land on the same day for the same doctor.
  await confirmedAhead(flagship, paeds, watDay(nextDay(1, WEEKDAYS), 8));
  await confirmedAhead(flagship, labourDoctor, watDay(6, 20));
  await confirmedAhead(flagship, theatre, watDay(nextDay(2, WEEKDAYS), 8));
  await confirmedAhead(flagship, midwife, watDay(1, 8));
  await confirmedAhead(flagship, pharmacy, watDay(2, 20));
  await confirmedAhead(flagship, lab, watDay(4, 20));
  await confirmedAhead(lagos, lagos.needs[0]!, watDay(3, 20));
  await confirmedAhead(kano, kano.needs[0]!, watDay(nextDay(2, WEEKDAYS), 8));

  // Offers waiting on the practitioner.
  {
    const { request, matchRunId } = await openShift({ facility: flagship, need: aeNight, start: watDay(4, 20), ref });
    await offer({ facility: flagship, requestId: request.id, people: [amina], matchRunId });
  }
  {
    // A day in A&E after her last night and before her leave — clear of
    // everything else on her rota, so accepting it is a real option.
    const aeDay: Need = { ...aeNight, shift: 'DAY', startHour: 8, rate: [7_500, 8_500] };
    const { request, matchRunId } = await openShift({ facility: flagship, need: aeDay, start: watDay(11, 8), ref });
    await offer({ facility: flagship, requestId: request.id, people: [amina], matchRunId });
  }
  {
    const weekend = nextDay(3, [0, 6]);
    const { request, matchRunId } = await openShift({ facility: flagship, need: wardDay, start: watDay(weekend, 8), ref });
    await offer({ facility: flagship, requestId: request.id, people: [chidi, byName('Segun Balogun')], matchRunId });
  }
  {
    const { request, matchRunId } = await openShift({ facility: flagship, need: icu, start: watDay(4, 20), ref });
    await offer({ facility: flagship, requestId: request.id, people: [blessing], matchRunId });
  }
  {
    const { request } = await openShift({ facility: lagos, need: lagos.needs[1]!, start: watDay(5, 8), ref });
    await offer({ facility: lagos, requestId: request.id, people: [byName('Precious Nnamdi')] });
  }

  // Accepted, waiting for the hospital to confirm.
  {
    const start = watDay(nextDay(4, WEEKDAYS), 8);
    const { request, matchRunId } = await openShift({ facility: flagship, need: paeds, start, ref });
    const halima = byName('Halima Sani');
    const [zainabOffer] = await offer({ facility: flagship, requestId: request.id, people: [zainab, halima], matchRunId });
    await respondToInvitation({ invitationId: zainabOffer!.id, userId: zainab.id, decision: 'accept' });
  }
  {
    // Nkechi Obiora is on leave that week, so the match shows her as blocked.
    const { request, matchRunId } = await openShift({ facility: flagship, need: labourDoctor, start: watDay(4, 20), ref });
    const olumide = byName('Olumide Oyelaran');
    const [invitation] = await offer({ facility: flagship, requestId: request.id, people: [olumide], matchRunId });
    await respondToInvitation({ invitationId: invitation!.id, userId: olumide.id, decision: 'accept' });
  }

  // Three ICU nurses wanted; one confirmed, one accepted, one place open.
  {
    const start = watDay(3, 20);
    const { request, matchRunId } = await openShift({ facility: flagship, need: icu, start, headcount: 3, ref });
    const ngozi = byName('Ngozi Eze');
    const comfort = byName('Comfort Ojo');
    const [ngoziOffer, comfortOffer] = await offer({ facility: flagship, requestId: request.id, people: [ngozi, comfort], matchRunId });
    await acceptAndConfirm(flagship, request.id, ngoziOffer!.id, ngozi);
    await respondToInvitation({ invitationId: comfortOffer!.id, userId: comfort.id, decision: 'accept' });
    book(ngozi.id, start, addHours(start, 12));
  }

  // Published with nobody asked yet: the scheduler's to match and offer.
  await openShift({ facility: flagship, need: theatre, start: watDay(nextDay(5, WEEKDAYS), 8), ref, match: false });
  await openShift({ facility: flagship, need: pharmacy, start: watDay(6, 20), ref, match: false });

  // A draft nobody has published.
  await openShift({ facility: flagship, need: radiology, start: watDay(nextDay(2, [6]), 8), ref, publish: false });

  // An emergency, matched, offers out to the top three.
  {
    const tonight = watHour(new Date()) < 17 ? 0 : 1;
    const { request, matchRunId, ranked } = await openShift({
      facility: flagship,
      need: { ...aeNight, specialty: undefined },
      start: watDay(tonight, 20),
      urgency: 'EMERGENCY',
      rate: [10_500, 11_500],
      notes: 'Accident & Emergency. EMERGENCY: two registrars off sick tonight. Any fully registered doctor with emergency experience; 14 trolleys and two resus bays.',
      ref,
    });
    const top = (await candidatesFor({
      facility: flagship, need: { category: 'doctor' }, start: watDay(tonight, 20), end: watDay(tonight + 1, 8),
      pool: livePool, ranked,
    })).slice(0, 3);
    if (top.length > 0) await offer({ facility: flagship, requestId: request.id, people: top, matchRunId, expiresInHours: 6 });
  }

  // The next public holiday: premium rates, one confirmed and one on offer.
  const nextHoliday = holidays
    .filter((row) => row.date.getTime() > Date.now() + DAY)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  if (nextHoliday) {
    const offset = Math.round((nextHoliday.date.getTime() - watDay(0).getTime() - WAT) / DAY);
    const holidayNote = `${nextHoliday.name} — public holiday; the holiday premium on the current rate card applies.`;
    await confirmedAhead(flagship, { ...wardDay, notes: `${holidayNote} ${wardDay.notes}` }, watDay(offset, 8), chidi);
    const { request, matchRunId } = await openShift({
      facility: flagship, need: aeNight, start: watDay(offset, 20), rate: [9_000, 9_500],
      notes: `Accident & Emergency. ${holidayNote} ${aeNight.notes}`, ref,
    });
    await offer({ facility: flagship, requestId: request.id, people: [byName('Aisha Mohammed')], matchRunId });
  }

  // Cancelled before anyone was offered it.
  {
    // Day 9 onwards, so it never shares a date with the open list above.
    const { request } = await openShift({ facility: flagship, need: theatre, start: watDay(nextDay(9, WEEKDAYS), 8), ref, match: false });
    await cancelServiceRequest({
      requestId: request.id, facilityId: flagship.id, actorId: flagship.owner.id,
      reason: 'Elective list cancelled: the consultant surgeon is on annual leave that week.',
    });
  }

  // Confirmed, then released: the request reopens for cover.
  {
    const obinna = byName('Obinna Eze');
    const weekend = nextDay(8, [0, 6]);
    const held = await confirmedAhead(flagship, wardDay, watDay(weekend, 8), obinna);
    if (held) {
      await cancelAssignment({
        assignmentId: held.assignment.id, facilityId: flagship.id, actorId: flagship.scheduler.id,
        reason: 'Practitioner asked to be released for a family emergency; the shift is open again for cover.',
      });
    }
  }
  log('  a shift in progress, one starting within the hour, upcoming rota, offers out, acceptances to confirm, open and draft shifts');

  // Levels for doctors, defined last. Once a profession has levels every new request for it
  // has to name one, and the history above was written before there were any, which is what a
  // platform that starts using levels part-way through looks like. The names and ranks are
  // illustrations: what a profession's levels are is the regulators' to say, and none ships.
  log('Defining demo levels for doctors, and recording where the demo doctors stand…');
  {
    const doctorId = ref.categories.get('doctor')!.id;
    const levels = [];
    for (const [name, rank] of [['House officer', 10], ['Medical officer', 20], ['Registrar', 30], ['Consultant', 40]] as const) {
      levels.push(await createCadreLevel({ professionalCategoryId: doctorId, name, rank, actorId: superAdmin.id }));
    }
    const full = await createRegistrationCategory({ name: 'Full registration', supervisionRequired: false, actorId: superAdmin.id });
    const provisional = await createRegistrationCategory({ name: 'Provisional registration', supervisionRequired: true, actorId: superAdmin.id });

    let recorded = 0;
    const doctors = practitioners.filter((person) => person.spec.category === 'doctor' && (person.spec.stage ?? 'complete') === 'complete');
    for (const [position, person] of doctors.entries()) {
      const level = levels[position % levels.length]!;
      try {
        await recordPractitionerStanding({
          userId: person.id,
          cadreLevelId: level.id,
          // A house officer is on a provisional register until fully registered.
          registrationCategoryId: level.name === 'House officer' ? provisional.id : full.id,
          actorId: compliance.id,
        });
        recorded += 1;
      } catch {
        // No registration recorded for them (a stuck onboarding persona): nothing to rest a level on.
      }
    }

    // One shift that asks for a level, so the match shows it being applied.
    const registrar = levels.find((level) => level.name === 'Registrar')!;
    await openShift({
      facility: flagship, need: paeds, start: watDay(nextDay(3, WEEKDAYS), 8), ref,
      cadreLevelId: registrar.id, supervisionAvailable: false,
      notes: 'Paediatric registrar for the ward round and the clinic. Registrars only.',
    });
    log(`  4 levels and 2 registration categories; ${recorded} doctors recorded; a registrar shift published`);
  }

  // Revised last, not before the work above. Publishing a revised notice means everyone
  // who has not accepted it is asked to before they can accept an offer, and the work above
  // takes people through offers; Amina in particular is deliberately left not having accepted.
  // A revised privacy notice two weeks ago. Most practitioners have accepted
  // it; Amina has not, so her privacy page has something to do.
  const privacy2026 = await publishAgreement({
    kind: 'PRIVACY_NOTICE',
    identifier: `${AGREEMENT_PREFIX}privacy-notice-2026`,
    title: 'Privacy notice, 2026',
    body: PRIVACY_NOTICE_2026_BODY,
    effectiveFrom: watDay(-14, 0),
    actorId: compliance.id,
  });
  let acceptedNew = 0;
  for (const person of practitioners) {
    if (person === amina || person.spec.stage === 'no_profile' || person.spec.problem === 'suspended') continue;
    if (chance(0.2)) continue;
    await acceptAgreement({ userId: person.id, versionId: privacy2026.id });
    acceptedNew += 1;
  }
  await prisma.agreementAcceptance.updateMany({
    where: { versionId: privacy2026.id },
    data: { acceptedAt: watDay(-between(1, 12), 10) },
  });
  log(`  privacy notice revised; ${acceptedNew} practitioners have accepted the new version`);

  // ------------------------------------------------------------ summary
  const counts = {
    users: await prisma.user.count({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } }),
    serviceRequests: await prisma.serviceRequest.count({ where: { facilityId: { in: facilities.map((f) => f.id) } } }),
    assignments: await prisma.assignment.count({ where: { facilityId: { in: facilities.map((f) => f.id) } } }),
    auditRows: await prisma.auditLog.count(),
  };
  log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s — ${JSON.stringify(counts)}`);

  log('\nSign in at http://localhost:3000/login — every account shares one password.');
  log(`Phone numbers work in either form: +2348031200021 or 0803 120 0021.\n`);
  log(`  password  ${DEMO_PASSWORD}\n`);
  const row = (phone: string, name: string, label: string) =>
    log(`  ${phone}  ${name.padEnd(24)} ${label}`);

  log('  PLATFORM (/admin)');
  for (const spec of PLATFORM_STAFF) row(spec.phone, spec.fullName, spec.label);
  log(`\n  FACILITY — ${flagship.name} (/facility)`);
  row(flagship.owner.phone, flagship.owner.fullName, 'Facility owner (Medical Director) — everything, incl. adding staff');
  row(flagship.administrator!.phone, flagship.administrator!.fullName, 'Facility administrator — the whole facility console');
  row(flagship.scheduler.phone, flagship.scheduler.fullName, 'Facility administrator — same role; shifts and matching are where they work');
  row(flagship.financeOfficer!.phone, flagship.financeOfficer!.fullName, 'Facility administrator — same role; timesheets and invoices are where they work');
  log('\n  OTHER FACILITIES');
  row(lagos.owner.phone, lagos.owner.fullName, `Owner, ${lagos.name} (Lagos)`);
  row(kano.owner.phone, kano.owner.fullName, `Owner, ${kano.name} (Kano)`);
  row(phoneFor(45), 'Tamuno Briggs', `Owner, ${pendingFacilityName} — awaiting verification`);
  row(phoneFor(46), 'Chukwudi Anyanwu', `Owner, ${rejectedFacilityName} — refused`);
  log('\n  PRACTITIONERS (/practitioner)');
  for (const person of practitioners) {
    if (person.spec.key) row(person.phone, person.fullName, person.spec.label ?? '');
  }
  log(`\n  …and ${practitioners.filter((p) => !p.spec.key).length} more pool practitioners on +2348031200101 onwards.`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
