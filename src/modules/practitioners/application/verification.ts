import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import {
  identityVerifier,
  isAutomatedIdentityVerificationEnabled,
  isAutomatedRegistrationVerificationEnabled,
  registrationVerifier,
} from '@/lib/verification';
import {
  hashNin,
  isRegistrationUsable,
  ninLast4,
  normaliseFolioNumber,
  normaliseNin,
  type RegistrationStatusValue,
} from '../domain/verification';
import { PractitionerErrors } from '../domain/errors';

/**
 * Steps 5.3, 5.4 and 5.5: who this practitioner is, and what their regulator
 * says about them.
 *
 * Both records take the same shape whether the evidence came from a provider
 * or from a compliance officer reading a document. That is the point of the
 * toggles in src/lib/verification: with them off — the default, because
 * neither subscription exists — an officer supplies the evidence through the
 * same endpoint, and switching a provider on later changes only the `method`
 * and `source` columns.
 */

export interface IdentityVerificationView {
  userId: string;
  /** The last four digits. The number itself is never returned. */
  ninLast4: string;
  nameMatch: boolean;
  method: 'MANUAL' | 'NIMC';
  verifiedBy: string | null;
  verifiedAt: Date;
  evidenceRetrievedAt: Date;
}

interface IdentityRow {
  userId: string;
  ninLast4: string;
  nameMatch: boolean;
  method: 'MANUAL' | 'NIMC';
  verifiedBy: string | null;
  verifiedAt: Date;
  evidenceRetrievedAt: Date;
}

/**
 * Note what is absent: `ninHash` never reaches a view, an audit row or a
 * response. It is a lookup key, not information anyone needs to read back.
 */
function toIdentityView(row: IdentityRow): IdentityVerificationView {
  return {
    userId: row.userId,
    ninLast4: row.ninLast4,
    nameMatch: row.nameMatch,
    method: row.method,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
    evidenceRetrievedAt: row.evidenceRetrievedAt,
  };
}

export interface RecordIdentityParams {
  userId: string;
  /** Raw, used to derive the digest and the last four, then discarded. */
  nin: string;
  /** A manual reviewer's assertion that the name on the slip matches. */
  nameMatch?: boolean;
  actorId: string;
}

export async function recordIdentityVerification(
  input: RecordIdentityParams,
): Promise<IdentityVerificationView> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, fullName: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw PractitionerErrors.practitionerNotFound();

  const nin = normaliseNin(input.nin);
  const now = new Date();

  let nameMatch: boolean;
  let evidenceRetrievedAt: Date;
  let method: 'MANUAL' | 'NIMC';

  if (isAutomatedIdentityVerificationEnabled()) {
    const result = await identityVerifier().check({ nin, fullName: user.fullName });
    nameMatch = result.nameMatch;
    evidenceRetrievedAt = result.retrievedAt;
    method = 'NIMC';
  } else {
    // The default path: an officer has read the slip. They must say whether
    // the name matched — there is no sensible default for that, and assuming
    // `true` would let a mismatched identity through silently.
    if (input.nameMatch === undefined) throw PractitionerErrors.nameMatchRequired();
    nameMatch = input.nameMatch;
    evidenceRetrievedAt = now;
    method = 'MANUAL';
  }

  const ninHash = hashNin(nin, env.SESSION_SECRET);
  const last4 = ninLast4(nin);

  try {
    return await prisma.$transaction(async (tx) => {
      const saved = await tx.identityVerification.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          ninHash,
          ninLast4: last4,
          nameMatch,
          method,
          verifiedBy: input.actorId,
          verifiedAt: now,
          evidenceRetrievedAt,
        },
        update: {
          ninHash,
          ninLast4: last4,
          nameMatch,
          method,
          verifiedBy: input.actorId,
          verifiedAt: now,
          evidenceRetrievedAt,
        },
      });

      await recordAudit(tx, {
        action: 'practitioner.identity_verified',
        entityType: 'practitioners.identity_verifications',
        entityId: saved.id,
        actorId: input.actorId,
        scopeType: 'SELF',
        scopeId: input.userId,
        // Deliberately only the last four and the outcome. The audit trail is
        // read by more people than the record itself, and it is append-only:
        // a NIN written here could never be taken back out.
        after: { ninLast4: last4, nameMatch, method, evidenceRetrievedAt },
      });

      return toIdentityView(saved);
    });
  } catch (error) {
    // Step 5.4: refused by the constraint, not by a prior read, so two
    // concurrent registrations of the same identity cannot both win.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw PractitionerErrors.duplicateNin();
    }
    throw error;
  }
}

export async function getIdentityVerification(
  userId: string,
): Promise<IdentityVerificationView | null> {
  const row = await prisma.identityVerification.findUnique({ where: { userId } });
  return row ? toIdentityView(row) : null;
}

export interface ProfessionalRegistrationView {
  id: string;
  userId: string;
  regulator: string;
  folioNumber: string;
  practiceType: string | null;
  registrationStatus: RegistrationStatusValue;
  location: string | null;
  evidenceRetrievedAt: Date;
  expiresAt: Date | null;
  source: 'MANUAL' | 'REGULATOR_API';
  recordedBy: string | null;
  /** Derived: whether this registration currently permits practice. */
  usable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RegistrationRow {
  id: string;
  userId: string;
  regulator: string;
  folioNumber: string;
  practiceType: string | null;
  registrationStatus: RegistrationStatusValue;
  location: string | null;
  evidenceRetrievedAt: Date;
  expiresAt: Date | null;
  source: 'MANUAL' | 'REGULATOR_API';
  recordedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function toRegistrationView(row: RegistrationRow, now = new Date()): ProfessionalRegistrationView {
  return {
    id: row.id,
    userId: row.userId,
    regulator: row.regulator,
    folioNumber: row.folioNumber,
    practiceType: row.practiceType,
    registrationStatus: row.registrationStatus,
    location: row.location,
    evidenceRetrievedAt: row.evidenceRetrievedAt,
    expiresAt: row.expiresAt,
    source: row.source,
    recordedBy: row.recordedBy,
    usable: isRegistrationUsable(row, now),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface RecordRegistrationParams {
  userId: string;
  regulator: string;
  folioNumber: string;
  registrationStatus?: RegistrationStatusValue;
  practiceType?: string;
  location?: string;
  expiresAt?: Date;
  actorId: string;
}

export async function recordProfessionalRegistration(
  input: RecordRegistrationParams,
): Promise<ProfessionalRegistrationView> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw PractitionerErrors.practitionerNotFound();

  const folioNumber = normaliseFolioNumber(input.folioNumber);
  const now = new Date();

  let registrationStatus: RegistrationStatusValue;
  let practiceType = input.practiceType ?? null;
  let location = input.location ?? null;
  let expiresAt = input.expiresAt ?? null;
  let evidenceRetrievedAt = now;
  let source: 'MANUAL' | 'REGULATOR_API';

  if (isAutomatedRegistrationVerificationEnabled()) {
    const result = await registrationVerifier().check({ folioNumber, regulator: input.regulator });
    registrationStatus = result.registrationStatus;
    practiceType = result.practiceType;
    location = result.location;
    expiresAt = result.expiresAt;
    evidenceRetrievedAt = result.retrievedAt;
    source = 'REGULATOR_API';
  } else {
    // Manual: the officer says what the register showed. No default status —
    // assuming ACTIVE would be assuming the answer to the only question
    // being asked.
    if (!input.registrationStatus) throw PractitionerErrors.registrationStatusRequired();
    registrationStatus = input.registrationStatus;
    source = 'MANUAL';
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.professionalRegistration.findUnique({
        where: { userId_regulator: { userId: input.userId, regulator: input.regulator } },
      });

      const data = {
        folioNumber,
        practiceType,
        registrationStatus,
        location,
        evidenceRetrievedAt,
        expiresAt,
        source,
        recordedBy: input.actorId,
        deletedAt: null,
      };

      const saved = existing
        ? await tx.professionalRegistration.update({ where: { id: existing.id }, data })
        : await tx.professionalRegistration.create({
            data: { userId: input.userId, regulator: input.regulator, ...data },
          });

      await recordAudit(tx, {
        action: 'practitioner.registration_recorded',
        entityType: 'practitioners.professional_registrations',
        entityId: saved.id,
        actorId: input.actorId,
        scopeType: 'SELF',
        scopeId: input.userId,
        before: existing ? toRegistrationView(existing, now) : undefined,
        after: toRegistrationView(saved, now),
      });

      return toRegistrationView(saved, now);
    });
  } catch (error) {
    // Step 5.4 again: one folio belongs to one practitioner, enforced by the
    // database.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw PractitionerErrors.duplicateFolioNumber();
    }
    throw error;
  }
}

export async function listProfessionalRegistrations(
  userId: string,
): Promise<ProfessionalRegistrationView[]> {
  const rows = await prisma.professionalRegistration.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => toRegistrationView(row));
}

export interface VerificationSummary {
  userId: string;
  identity: IdentityVerificationView | null;
  registrations: ProfessionalRegistrationView[];
}

export async function getVerificationSummary(userId: string): Promise<VerificationSummary> {
  const [identity, registrations] = await Promise.all([
    getIdentityVerification(userId),
    listProfessionalRegistrations(userId),
  ]);
  return { userId, identity, registrations };
}
