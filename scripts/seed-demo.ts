/**
 * A pilot's worth of data, built the way the product builds it.
 *
 * Every record here goes through the application layer — not raw inserts — so
 * what comes out is genuinely consistent: audit rows exist because the code
 * that writes them ran, the outbox has events because something published
 * them, and the ledger balances because `assertBalanced` refused anything
 * that did not. A seed of straight `prisma.create` calls would produce a
 * database that looks right and is not, and the first thing it would hide is
 * a missing audit row.
 *
 * Local only, for the reason bootstrap-demo is: it creates accounts with a
 * known password.
 *
 *   docker compose exec web pnpm tsx scripts/bootstrap-demo.ts
 *   docker compose exec web pnpm tsx scripts/seed-demo.ts
 *
 * Re-runnable. It clears what it made first, so you get the same picture
 * rather than three months of duplicates.
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '../src/lib/authz/permissions';

import { createFacility, verifyFacility } from '../src/modules/facilities/application/facility';
import { createProfile } from '../src/modules/practitioners/application/profile';
import {
  recordIdentityVerification,
  recordProfessionalRegistration,
} from '../src/modules/practitioners/application/verification';
import {
  requestDocumentUploadUrl,
  reviewCredential,
  submitCredential,
} from '../src/modules/credentials/application/submission';
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
import { submitTimesheet, reviewTimesheet } from '../src/modules/timesheets/application/timesheet';
import { createRateCard } from '../src/modules/rates-contracts/application/rate-card';
import {
  generateInvoice,
  issueInvoice,
  recordPayment,
} from '../src/modules/billing-settlement/application/invoice';
import { preparePayout, releasePayout } from '../src/modules/billing-settlement/application/payout';
import { reportIncident } from '../src/modules/clinical-incidents/application/incident';
import { submitSuggestion } from '../src/modules/suggestions/application/suggestion';
import { raiseDispute } from '../src/modules/disputes/application/dispute';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Medilink-demo-2026';
const APP_ENV = process.env.APP_ENV ?? 'local';

/** Everything this script makes is tagged so it can clear up after itself. */
const MARKER = 'SEEDDEMO';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.info(message);
}

/** Deterministic, so two runs produce the same picture rather than noise. */
let seed = 20260914;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

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

async function uploadPlaceholder(url: string): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: new Uint8Array(PLACEHOLDER_PDF),
  });
  if (!response.ok) {
    throw new Error(`Storage refused the upload (${response.status}). Is the storage container up?`);
  }
}

function between(low: number, high: number): number {
  return Math.floor(low + random() * (high - low + 1));
}

const FIRST_NAMES = [
  'Amina', 'Chidi', 'Ngozi', 'Ibrahim', 'Folake', 'Emeka', 'Hauwa', 'Tunde',
  'Blessing', 'Yusuf', 'Chioma', 'Segun', 'Zainab', 'Obiageli', 'Musa', 'Funmi',
];
const LAST_NAMES = [
  'Okafor', 'Bello', 'Adeyemi', 'Eze', 'Danjuma', 'Okonkwo', 'Aliyu', 'Balogun',
  'Nwosu', 'Suleiman', 'Oyelaran', 'Abubakar',
];

const FACILITIES = [
  { name: 'Lagos University Teaching Hospital', address: 'Idi-Araba, Surulere, Lagos', verified: true },
  { name: 'Aminu Kano Teaching Hospital', address: 'Zaria Road, Kano', verified: true },
  { name: 'Garki General Hospital', address: 'Area 3, Garki, Abuja', verified: true },
  // Left pending on purpose, so the verification queue is not empty.
  { name: 'Riverside Specialist Clinic', address: '12 Marine Road, Port Harcourt', verified: false },
];

/** What a practitioner says when they turn a shift down. These feed the suggestion log. */
const DECLINE_REASONS = [
  'The rate is below what I am paid for the same shift elsewhere.',
  'Too far to travel for a single night, and there is no transport after midnight.',
  'Less than a day of notice; I could not rearrange my clinic.',
  'I am already on nights that week and cannot do another.',
];

const SUGGESTIONS = [
  { area: 'MATCHING', body: 'I keep being offered shifts in a state I said I would not travel to.' },
  { area: 'PAYMENTS', body: 'It is not clear when I will actually be paid after a timesheet is approved.' },
  { area: 'ATTENDANCE', body: 'The check-in code lapses before the ward staff have finished reading it out.' },
  { area: 'ONBOARDING', body: 'Nothing tells me which credentials are still missing until I am refused work.' },
];

const INCIDENTS = [
  {
    severity: 'NEAR_MISS',
    category: 'MEDICATION',
    summary:
      'Wrong strength of insulin drawn up and caught by the second checker before it reached the patient. The two vials are near-identical and stored side by side.',
  },
  {
    severity: 'MINOR',
    category: 'DOCUMENTATION',
    summary:
      'Handover notes for two patients in adjacent beds were filed against the wrong records. Found at the next drug round and corrected; no treatment was given on the wrong notes.',
  },
  {
    severity: 'MODERATE',
    category: 'STAFFING',
    summary:
      'Night shift ran with one nurse short after a late cancellation. Observations on the bay were forty minutes late and one patient deteriorated before it was noticed.',
  },
  {
    severity: 'NEAR_MISS',
    category: 'EQUIPMENT',
    summary:
      'Infusion pump alarmed and could not be silenced; a spare was found on another ward. The pump had not been serviced within its interval.',
  },
];

interface Actor {
  id: string;
  fullName: string;
  phone: string;
}

let phoneCounter = 0;
function nextPhone(): string {
  phoneCounter += 1;
  return `+23480312${String(20000 + phoneCounter).slice(-5)}`;
}

/** A user with a role at a scope, created the way registration would. */
async function makeUser(
  fullName: string,
  role: keyof typeof ROLE_PERMISSIONS,
  scopeType: 'PLATFORM' | 'SELF' | 'FACILITY',
  scopeId?: string,
): Promise<Actor> {
  const phone = nextPhone();
  const user = await prisma.user.create({
    data: {
      fullName,
      phone,
      status: 'ACTIVE',
      passwordHash: await hashPassword(DEMO_PASSWORD),
      phoneVerifiedAt: new Date(),
      // Tagged so `clear()` can find exactly what this script made.
      email: `${MARKER.toLowerCase()}.${phone.slice(-5)}@example.test`,
    },
  });

  // Permissions are rows joined through role_permissions, not a string column
  // — a role created without them exists and authorises nothing, which looks
  // exactly like a grant that silently failed.
  const permissions = (ROLE_PERMISSIONS[role] ?? []) as Permission[];
  const roleRow = await prisma.role.upsert({
    where: { key: role },
    update: {},
    create: { key: role, name: role },
  });
  for (const permissionKey of permissions) {
    const permission = await prisma.permission.upsert({
      where: { key: permissionKey },
      update: {},
      create: { key: permissionKey, description: PERMISSIONS[permissionKey] },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: roleRow.id, permissionId: permission.id } },
      update: {},
      create: { roleId: roleRow.id, permissionId: permission.id },
    });
  }
  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: roleRow.id,
      scopeType,
      scopeId: scopeType === 'SELF' ? user.id : (scopeId ?? null),
    },
  });

  return { id: user.id, fullName, phone };
}

/**
 * Removes everything a previous run made, so the script is re-runnable.
 *
 * Users are found by the tagged email; everything else cascades from them or
 * from the facilities, which are matched on their CAC prefix.
 */
async function clear(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: `${MARKER.toLowerCase()}.` } },
    select: { id: true },
  });
  const userIds = users.map((row) => row.id);
  const facilities = await prisma.facility.findMany({
    where: { cacNumber: { startsWith: 'RC77' } },
    select: { id: true },
  });
  const facilityIds = facilities.map((row) => row.id);
  if (userIds.length === 0 && facilityIds.length === 0) return;

  // Order matters where a foreign key is Restrict rather than Cascade.
  /**
   * Whole transactions, not entries by subject.
   *
   * `CASH` and `PLATFORM_REVENUE` carry no subject, so deleting by subject
   * removes one side of a payment and leaves the other — which is how a
   * re-run left the ledger holding fourteen half-transactions and a balance
   * that should have been zero. The ledger itself refused nothing, because
   * every transaction *was* balanced when it was written.
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
  await prisma.rateCard.deleteMany({ where: { facilityId: { in: facilityIds } } });
  await prisma.clinicalIncident.deleteMany({ where: { facilityId: { in: facilityIds } } });
  await prisma.suggestion.deleteMany({ where: { raisedBy: { in: userIds } } });
  // Assignments and everything hanging off a service request go first: the
  // foreign keys are Restrict, which is right — removing a facility must
  // never silently remove the shifts somebody worked for it.
  const requests = await prisma.serviceRequest.findMany({
    where: { facilityId: { in: facilityIds } },
    select: { id: true },
  });
  const requestIds = requests.map((row) => row.id);
  await prisma.assignment.deleteMany({ where: { serviceRequestId: { in: requestIds } } });
  await prisma.invitation.deleteMany({ where: { serviceRequestId: { in: requestIds } } });
  await prisma.matchRun.deleteMany({ where: { serviceRequestId: { in: requestIds } } });
  await prisma.serviceRequest.deleteMany({ where: { facilityId: { in: facilityIds } } });
  await prisma.facility.deleteMany({ where: { id: { in: facilityIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  log(`  cleared ${userIds.length} users and ${facilityIds.length} facilities from a previous run`);
}

async function main(): Promise<void> {
  if (APP_ENV !== 'local') {
    throw new Error(`seed-demo refuses to run in ${APP_ENV}. It creates accounts with a known password.`);
  }

  log('Clearing anything a previous run left behind…');
  await clear();

  const category = await prisma.professionalCategory.findFirstOrThrow();
  const facilityType = await prisma.facilityType.findFirstOrThrow();
  const states = await prisma.state.findMany({ take: 4 });
  // One of each verification method, so both submission paths are exercised.
  const credentialTypes = await prisma.credentialType.findMany({
    where: { key: { in: ['mdcn_practising_licence', 'good_standing'] } },
  });
  if (states.length === 0 || credentialTypes.length === 0) {
    throw new Error('Run `pnpm db:seed` first — the controlled vocabularies are empty.');
  }

  log('Creating platform staff…');
  const ops = await makeUser('Adaeze Operations', 'operations_officer', 'PLATFORM');
  const compliance = await makeUser('Musa Compliance', 'compliance_officer', 'PLATFORM');
  const finance = await makeUser('Ifeoma Finance', 'finance_officer', 'PLATFORM');

  log('Onboarding facilities…');
  const facilities: { id: string; name: string; scheduler: Actor; manager: Actor }[] = [];

  for (const [index, spec] of FACILITIES.entries()) {
    const state = states[index % states.length]!;
    const facility = await createFacility({
      name: spec.name,
      facilityTypeId: facilityType.id,
      cacNumber: `RC77${String(1000 + index)}`,
      stateId: state.id,
      addressLine: spec.address,
      contactPhone: nextPhone(),
      representativeUserId: ops.id,
      actorId: ops.id,
    });

    if (spec.verified) {
      await verifyFacility({
        facilityId: facility.id,
        verifierId: compliance.id,
        decision: 'approve',
      });
    }

    const scheduler = await makeUser(
      `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      'facility_scheduler',
      'FACILITY',
      facility.id,
    );
    const manager = await makeUser(
      `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
      'facility_owner',
      'FACILITY',
      facility.id,
    );

    if (spec.verified) facilities.push({ id: facility.id, name: spec.name, scheduler, manager });
    log(`  ${spec.name} — ${spec.verified ? 'verified' : 'awaiting verification'}`);
  }

  /**
   * A rate card on one facility only.
   *
   * The point of the data is to show the difference: one hospital pays a
   * night premium and the others do not, so the invoices are not all the same
   * shape and the charts have something to compare.
   */
  await createRateCard({
    facilityId: facilities[0]!.id,
    actorId: facilities[0]!.manager.id,
    name: 'Nights and holidays, 2026',
    nightMultiplierBp: 15_000,
    holidayMultiplierBp: 20_000,
  });
  log(`  ${facilities[0]!.name} pays 1.5x nights and 2x holidays`);

  log('Registering practitioners…');
  const practitioners: Actor[] = [];

  for (let index = 0; index < 10; index += 1) {
    const name = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[index % LAST_NAMES.length]}`;
    const actor = await makeUser(name, 'practitioner', 'SELF');

    await createProfile({
      userId: actor.id,
      professionalCategoryId: category.id,
      yearsOfExperience: between(1, 18),
      homeStateId: pick(states).id,
      travelPreference: pick(['SAME_STATE', 'ANYWHERE', 'ANYWHERE'] as const),
      bio: 'Locum cover across medical and surgical wards.',
    });

    // A standing weekday pattern, or the matcher has nothing to check a
    // shift against and everybody comes back unavailable.
    for (const dayOfWeek of [1, 2, 3, 4, 5]) {
      await addSlot({
        userId: actor.id,
        kind: 'RECURRING_WEEKLY',
        dayOfWeek,
        startMinute: 0,
        endMinute: 24 * 60 - 1,
      });
    }

    /**
     * Eight of the ten are fully onboarded; two are left mid-way on purpose.
     * A queue with nothing in it demonstrates nothing, and "why am I not
     * being offered work" is the question the eligibility panel exists to
     * answer.
     */
    const complete = index < 8;

    await recordIdentityVerification({
      userId: actor.id,
      nin: String(10_000_000_000 + index * 7_919),
      nameMatch: true,
      actorId: compliance.id,
    });

    await recordProfessionalRegistration({
      userId: actor.id,
      regulator: 'MDCN',
      folioNumber: `MDCN/${60_000 + index}`,
      registrationStatus: 'ACTIVE',
      expiresAt: new Date(Date.now() + 300 * DAY),
      actorId: compliance.id,
    });

    for (const credentialType of credentialTypes) {
      /**
       * Most credential types are verified by looking at a document, and
       * `submitCredential` refuses one without a key that resolves to a real
       * stored object. So the upload URL is requested properly rather than a
       * key being invented — the file itself never arrives, which is exactly
       * the state a submission sits in between the browser asking for a URL
       * and the upload finishing.
       */
      const needsDocument = credentialType.verificationMethod === 'document_review';
      let documentObjectKey: string | undefined;
      if (needsDocument) {
        const upload = await requestDocumentUploadUrl({
          userId: actor.id,
          filename: `${credentialType.key}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: PLACEHOLDER_PDF.byteLength,
        });
        // Really uploaded, through the signed URL, because the submission
        // does a HEAD against storage before it will accept the key. A row
        // marked uploaded with nothing behind it would pass the seed and fail
        // the first time anybody clicked "view document".
        await uploadPlaceholder(upload.uploadUrl);
        documentObjectKey = upload.objectKey;
      }

      const submission = await submitCredential({
        userId: actor.id,
        credentialTypeId: credentialType.id,
        referenceNumber: needsDocument
          ? undefined
          : `${credentialType.key.slice(0, 4).toUpperCase()}-${70_000 + index}`,
        documentObjectKey,
      });

      if (complete) {
        await reviewCredential({
          submissionId: submission.id,
          reviewerId: compliance.id,
          decision: 'approve',
        });
      }
      // The incomplete two leave theirs PENDING, which is what fills the
      // credential queue.
    }

    practitioners.push(actor);
    if (complete) await prisma.user.update({ where: { id: actor.id }, data: { status: 'ACTIVE' } });
  }

  const eligible = practitioners.slice(0, 8);
  log(`  ${practitioners.length} practitioners, ${eligible.length} fully verified`);

  const floors = await prisma.rateFloor.findMany({ where: { categoryKey: category.key } });
  const floorFor = (shiftType: string) =>
    Math.max(
      ...floors.filter((row) => row.shiftType === shiftType).map((row) => row.minHourlyKobo),
      0,
    );
  const dayFloorKobo = floorFor('day') || 500_000;
  const nightFloorKobo = floorFor('night') || 650_000;

  log('Working three months of shifts…');

  let worked = 0;
  let declined = 0;
  let unattended = 0;
  const disputable: { assignmentId: string; userId: string }[] = [];

  for (let weeksAgo = 12; weeksAgo >= 0; weeksAgo -= 1) {
    for (const facility of facilities) {
      const shiftsThisWeek = between(1, 3);

      for (let n = 0; n < shiftsThisWeek; n += 1) {
        /**
         * Published two hours out, then backdated.
         *
         * Publishing refuses a shift that has already started — correctly, and
         * the sweep in step 5.9 depends on it. So the request is created as a
         * real future shift, taken through the whole flow, and only then moved
         * into the past. That is the one place this script edits a row
         * directly, and it edits *when*, never *what*.
         */
        const night = random() < 0.4;
        const startsAt = new Date(Date.now() + 2 * HOUR);
        const endsAt = new Date(startsAt.getTime() + 8 * HOUR);
        // Above the floor for this category and shift, by a margin a real
        // facility would offer. Read from the floors rather than hardcoded,
        // so the data respects the rule instead of coincidentally clearing it.
        const floorKobo = night ? nightFloorKobo : dayFloorKobo;
        const hourlyRateKobo = floorKobo + between(0, 8) * 25_000;

        const request = await createServiceRequest({
          facilityId: facility.id,
          professionalCategoryId: category.id,
          shiftType: night ? 'NIGHT' : 'DAY',
          startsAt,
          endsAt,
          headcount: 1,
          hourlyRateKobo,
          urgency: pick(['ROUTINE', 'ROUTINE', 'ROUTINE', 'URGENT', 'EMERGENCY'] as const),
          cancellationTerms:
            'Either party may cancel up to 24 hours before the shift without penalty. Inside 24 hours the shift is payable in full unless cover is agreed.',
          notes: pick([
            'Report to the nursing station on the second floor.',
            'Medical ward, 28 beds. Handover at the start of the shift.',
            'Bring your own stethoscope; scrubs are provided.',
          ]),
          actorId: facility.scheduler.id,
        });

        await publishServiceRequest({
          requestId: request.id,
          facilityId: facility.id,
          actorId: facility.scheduler.id,
        });

        // Offer it to three, and let one or two turn it down — the decline
        // reasons are what feed the suggestion log.
        const offered = [...eligible].sort(() => random() - 0.5).slice(0, 3);
        const invitations = await invitePractitioners({
          requestId: request.id,
          facilityId: facility.id,
          userIds: offered.map((person) => person.id),
          actorId: facility.scheduler.id,
        });

        let accepted: Actor | null = null;
        for (const [index, invitation] of invitations.entries()) {
          const person = offered[index]!;
          if (accepted === null && random() < 0.7) {
            await respondToInvitation({
              invitationId: invitation.id,
              userId: person.id,
              decision: 'accept',
            });
            accepted = person;
          } else {
            await respondToInvitation({
              invitationId: invitation.id,
              userId: person.id,
              decision: 'decline',
              reason: pick(DECLINE_REASONS),
            });
            declined += 1;
          }
        }

        if (!accepted) continue;

        const assignment = await confirmAssignment({
          requestId: request.id,
          facilityId: facility.id,
          userId: accepted.id,
          actorId: facility.scheduler.id,
        });

        // Now move it to where it actually belongs in history.
        const realStart = new Date(Date.now() - weeksAgo * 7 * DAY - between(0, 6) * DAY);
        realStart.setUTCHours(night ? 19 : 7, 0, 0, 0);
        const realEnd = new Date(realStart.getTime() + 8 * HOUR);

        await prisma.serviceRequest.update({
          where: { id: request.id },
          data: { startsAt: realStart, endsAt: realEnd },
        });
        await prisma.assignment.update({
          where: { id: assignment.id },
          data: { startsAt: realStart, endsAt: realEnd },
        });

        // About one shift in fourteen is never attended, which is what gives
        // the unhonoured sweep something to find.
        if (random() < 0.07) {
          unattended += 1;
          continue;
        }

        await recordManualAttendance({
          assignmentId: assignment.id,
          actorId: facility.scheduler.id,
          checkedInAt: realStart,
          checkedOutAt: realEnd,
          breakMinutes: pick([0, 0, 30, 45, 60]),
          reason:
            'Recorded from the ward paper log during the pilot, before check-in codes were in daily use.',
        });

        await submitTimesheet({ assignmentId: assignment.id, userId: accepted.id });
        await reviewTimesheet({
          assignmentId: assignment.id,
          facilityId: facility.id,
          actorId: facility.manager.id,
          decision: 'approve',
        });

        worked += 1;
        if (disputable.length < 3 && random() < 0.1) {
          disputable.push({ assignmentId: assignment.id, userId: accepted.id });
        }
      }
    }
  }

  log(`  ${worked} shifts worked and approved, ${declined} offers declined, ${unattended} never attended`);

  log('Invoicing, paying and settling…');

  let raised = 0;
  let paid = 0;

  // One invoice per facility per month, which is how a facility would
  // actually be billed rather than one lump for the whole pilot.
  for (let monthsAgo = 3; monthsAgo >= 0; monthsAgo -= 1) {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1));

    for (const facility of facilities) {
      try {
        const invoice = await generateInvoice({
          facilityId: facility.id,
          periodStart,
          periodEnd,
          actorId: finance.id,
        });
        raised += 1;

        // The most recent month stays a draft, so the invoices page has one
        // of each state to show rather than a wall of PAID.
        if (monthsAgo === 0) continue;

        await issueInvoice({ invoiceId: invoice.id, actorId: finance.id });
        if (monthsAgo >= 1) {
          await recordPayment({ invoiceId: invoice.id, actorId: finance.id });
          paid += 1;
        }
      } catch {
        // Nothing approved in that month for that facility. Ordinary.
      }
    }
  }

  let settled = 0;
  for (const practitioner of eligible) {
    try {
      const payout = await preparePayout({
        practitionerId: practitioner.id,
        actorId: finance.id,
      });
      // Two thirds get released; the rest stay prepared, so the payouts page
      // shows the two-step nature of it rather than a list of finished rows.
      if (random() < 0.66) {
        await releasePayout({ payoutId: payout.id, actorId: finance.id });
        settled += 1;
      }
    } catch {
      // Owed nothing, because every shift they worked is on an unpaid
      // invoice. Also ordinary.
    }
  }

  log(`  ${raised} invoices raised, ${paid} paid, ${settled} payouts settled`);

  log('Filling the casework queues…');

  for (const [index, incident] of INCIDENTS.entries()) {
    const facility = facilities[index % facilities.length]!;
    await reportIncident({
      facilityId: facility.id,
      actorId: facility.manager.id,
      occurredAt: new Date(Date.now() - between(2, 30) * DAY),
      severity: incident.severity as 'NEAR_MISS' | 'MINOR' | 'MODERATE' | 'SEVERE' | 'DEATH',
      category: incident.category as 'MEDICATION' | 'DOCUMENTATION' | 'STAFFING' | 'EQUIPMENT',
      summary: incident.summary,
    });
  }

  for (const [index, suggestion] of SUGGESTIONS.entries()) {
    await submitSuggestion({
      userId: eligible[index % eligible.length]!.id,
      area: suggestion.area as 'MATCHING' | 'PAYMENTS' | 'ATTENDANCE' | 'ONBOARDING',
      body: suggestion.body,
    });
  }

  let disputes = 0;
  for (const candidate of disputable) {
    try {
      await raiseDispute({
        assignmentId: candidate.assignmentId,
        actorId: candidate.userId,
        category: 'HOURS',
        reason:
          'The approved hours are short by two: I stayed until the night staff arrived and the ward diary will show it.',
      });
      disputes += 1;
    } catch {
      // Outside the fourteen-day window, which is the rule working.
    }
  }

  log(`  ${INCIDENTS.length} incidents, ${SUGGESTIONS.length} suggestions, ${disputes} disputes`);

  log('\nDone. Sign in at http://localhost:3000/login — every account below shares one password.\n');
  log(`  password        ${DEMO_PASSWORD}`);
  log(`  operations      ${ops.phone}`);
  log(`  compliance      ${compliance.phone}`);
  log(`  finance         ${finance.phone}`);
  log(`  facility        ${facilities[0]!.scheduler.phone}  (${facilities[0]!.name})`);
  log(`  ward manager    ${facilities[0]!.manager.phone}`);
  log(`  practitioner    ${eligible[0]!.phone}  (${eligible[0]!.fullName})`);
  log(`  not yet cleared ${practitioners[9]!.phone}  (credentials still pending)`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
