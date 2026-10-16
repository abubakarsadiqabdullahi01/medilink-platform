import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
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

/**
 * What recording an identity needs, worked out and checked before anything is written: the
 * number normalised and digested, and either the officer's reading of the slip or the
 * provider's answer. A provider is asked here, outside any transaction, so that a call over
 * the network is never held inside one.
 */
export interface PreparedIdentity {
  userId: string;
  actorId: string;
  ninHash: string;
  ninLast4: string;
  nameMatch: boolean;
  method: 'MANUAL' | 'NIMC';
  verifiedAt: Date;
  evidenceRetrievedAt: Date;
}

export async function prepareIdentityVerification(input: RecordIdentityParams): Promise<PreparedIdentity> {
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

  return {
    userId: input.userId,
    actorId: input.actorId,
    ninHash: hashNin(nin, env.SESSION_SECRET),
    ninLast4: ninLast4(nin),
    nameMatch,
    method,
    verifiedAt: now,
    evidenceRetrievedAt,
  };
}

/** Writes a prepared identity and its audit row in the caller's transaction. */
export async function saveIdentityVerification(
  tx: Tx,
  prepared: PreparedIdentity,
): Promise<IdentityVerificationView> {
  const { userId, actorId, ninHash, ninLast4: last4, nameMatch, method, verifiedAt, evidenceRetrievedAt } = prepared;

  try {
    const saved = await tx.identityVerification.upsert({
      where: { userId },
      create: { userId, ninHash, ninLast4: last4, nameMatch, method, verifiedBy: actorId, verifiedAt, evidenceRetrievedAt },
      update: { ninHash, ninLast4: last4, nameMatch, method, verifiedBy: actorId, verifiedAt, evidenceRetrievedAt },
    });

    await recordAudit(tx, {
      action: 'practitioner.identity_verified',
      entityType: 'practitioners.identity_verifications',
      entityId: saved.id,
      actorId,
      scopeType: 'SELF',
      scopeId: userId,
      // Deliberately only the last four and the outcome. The audit trail is
      // read by more people than the record itself, and it is append-only:
      // a NIN written here could never be taken back out.
      after: { ninLast4: last4, nameMatch, method, evidenceRetrievedAt },
    });

    return toIdentityView(saved);
  } catch (error) {
    // Step 5.4: refused by the constraint, not by a prior read, so two
    // concurrent registrations of the same identity cannot both win.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw PractitionerErrors.duplicateNin();
    }
    throw error;
  }
}

export async function recordIdentityVerification(
  input: RecordIdentityParams,
): Promise<IdentityVerificationView> {
  const prepared = await prepareIdentityVerification(input);
  return prisma.$transaction((tx) => saveIdentityVerification(tx, prepared));
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
  /** Where they stand, as the officer read it from the register (PRA-01). */
  cadreLevel: { id: string; name: string; rank: number } | null;
  registrationCategory: { id: string; name: string; supervisionRequired: boolean } | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What a registration read for a view carries along, so a level is never a bare id. */
const STANDING_INCLUDE = {
  cadreLevel: { select: { id: true, name: true, rank: true } },
  registrationCategory: { select: { id: true, name: true, supervisionRequired: true } },
} as const;

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
  cadreLevel?: { id: string; name: string; rank: number } | null;
  registrationCategory?: { id: string; name: string; supervisionRequired: boolean } | null;
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
    cadreLevel: row.cadreLevel ?? null,
    registrationCategory: row.registrationCategory ?? null,
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
  /**
   * Where they stand on the register. Left out, whatever is recorded is kept (a
   * registration looked at again a year later does not forget the level); `null`
   * clears it.
   */
  cadreLevelId?: string | null;
  registrationCategoryId?: string | null;
  actorId: string;
}

/**
 * Whether a level and a category can be recorded for somebody: the level must be one
 * of their own profession's and in use, the category in use. Checked before anything
 * is written, so a refusal leaves nothing half-recorded.
 */
async function assertStanding(
  db: Pick<typeof prisma, 'cadreLevel' | 'registrationCategory' | 'practitionerProfile'>,
  userId: string,
  cadreLevelId: string | null | undefined,
  registrationCategoryId: string | null | undefined,
): Promise<void> {
  if (cadreLevelId) {
    const profile = await db.practitionerProfile.findUnique({
      where: { userId },
      select: { professionalCategoryId: true },
    });
    const level = await db.cadreLevel.findUnique({
      where: { id: cadreLevelId },
      select: { isActive: true, professionalCategoryId: true },
    });
    if (!profile || !level || !level.isActive || level.professionalCategoryId !== profile.professionalCategoryId) {
      throw PractitionerErrors.levelWrongProfession();
    }
  }
  if (registrationCategoryId) {
    const category = await db.registrationCategory.findUnique({
      where: { id: registrationCategoryId },
      select: { isActive: true },
    });
    if (!category || !category.isActive) throw PractitionerErrors.registrationCategoryInvalid();
  }
}

/**
 * What recording a registration needs, worked out and checked before anything is written:
 * the folio normalised, the level and category checked, and either the officer's reading of
 * the register or the provider's answer. As with an identity, the provider is asked here,
 * outside any transaction.
 */
export interface PreparedRegistration {
  userId: string;
  actorId: string;
  regulator: string;
  folioNumber: string;
  registrationStatus: RegistrationStatusValue;
  practiceType: string | null;
  location: string | null;
  expiresAt: Date | null;
  evidenceRetrievedAt: Date;
  source: 'MANUAL' | 'REGULATOR_API';
  cadreLevelId?: string | null;
  registrationCategoryId?: string | null;
  /** The moment the audit row's views are worked out at, so before and after agree. */
  now: Date;
}

export async function prepareProfessionalRegistration(
  input: RecordRegistrationParams,
): Promise<PreparedRegistration> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw PractitionerErrors.practitionerNotFound();

  const folioNumber = normaliseFolioNumber(input.folioNumber);
  const now = new Date();

  await assertStanding(prisma, input.userId, input.cadreLevelId, input.registrationCategoryId);

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

  return {
    userId: input.userId,
    actorId: input.actorId,
    regulator: input.regulator,
    folioNumber,
    registrationStatus,
    practiceType,
    location,
    expiresAt,
    evidenceRetrievedAt,
    source,
    cadreLevelId: input.cadreLevelId,
    registrationCategoryId: input.registrationCategoryId,
    now,
  };
}

/** Writes a prepared registration and its audit row in the caller's transaction. */
export async function saveProfessionalRegistration(
  tx: Tx,
  prepared: PreparedRegistration,
): Promise<ProfessionalRegistrationView> {
  const { userId, actorId, regulator, now } = prepared;

  try {
    const existing = await tx.professionalRegistration.findUnique({
      where: { userId_regulator: { userId, regulator } },
      include: STANDING_INCLUDE,
    });

    const data = {
      folioNumber: prepared.folioNumber,
      practiceType: prepared.practiceType,
      registrationStatus: prepared.registrationStatus,
      location: prepared.location,
      evidenceRetrievedAt: prepared.evidenceRetrievedAt,
      expiresAt: prepared.expiresAt,
      source: prepared.source,
      recordedBy: actorId,
      deletedAt: null,
      // Only what was said: leaving these out keeps what is recorded, which is what
      // looking at a registration again should do.
      ...(prepared.cadreLevelId !== undefined ? { cadreLevelId: prepared.cadreLevelId } : {}),
      ...(prepared.registrationCategoryId !== undefined
        ? { registrationCategoryId: prepared.registrationCategoryId }
        : {}),
    };

    const saved = existing
      ? await tx.professionalRegistration.update({
          where: { id: existing.id },
          data,
          include: STANDING_INCLUDE,
        })
      : await tx.professionalRegistration.create({
          data: { userId, regulator, ...data },
          include: STANDING_INCLUDE,
        });

    await recordAudit(tx, {
      action: 'practitioner.registration_recorded',
      entityType: 'practitioners.professional_registrations',
      entityId: saved.id,
      actorId,
      scopeType: 'SELF',
      scopeId: userId,
      before: existing ? toRegistrationView(existing, now) : undefined,
      after: toRegistrationView(saved, now),
    });

    return toRegistrationView(saved, now);
  } catch (error) {
    // Step 5.4 again: one folio belongs to one practitioner, enforced by the
    // database.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw PractitionerErrors.duplicateFolioNumber();
    }
    throw error;
  }
}

export async function recordProfessionalRegistration(
  input: RecordRegistrationParams,
): Promise<ProfessionalRegistrationView> {
  const prepared = await prepareProfessionalRegistration(input);
  return prisma.$transaction((tx) => saveProfessionalRegistration(tx, prepared));
}

export async function listProfessionalRegistrations(
  userId: string,
): Promise<ProfessionalRegistrationView[]> {
  const rows = await prisma.professionalRegistration.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    include: STANDING_INCLUDE,
  });
  return rows.map((row) => toRegistrationView(row));
}

/**
 * Records where somebody stands on the register: their level within the profession
 * and their registration category (PRA-01, PRA-02).
 *
 * It rests on a registration somebody has checked, so one has to exist: a level with no
 * licence behind it is a claim, and claims are what the register is there to replace.
 * Both are replaced by what is given here, and `null` clears one; the before and after
 * are on the audit trail.
 */
export async function recordPractitionerStanding(input: {
  userId: string;
  cadreLevelId: string | null;
  registrationCategoryId: string | null;
  actorId: string;
}): Promise<ProfessionalRegistrationView> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw PractitionerErrors.practitionerNotFound();

  await assertStanding(prisma, input.userId, input.cadreLevelId, input.registrationCategoryId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.professionalRegistration.findFirst({
      where: { userId: input.userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: STANDING_INCLUDE,
    });
    if (!existing) throw PractitionerErrors.registrationRequired();

    const saved = await tx.professionalRegistration.update({
      where: { id: existing.id },
      data: {
        cadreLevelId: input.cadreLevelId,
        registrationCategoryId: input.registrationCategoryId,
      },
      include: STANDING_INCLUDE,
    });

    await recordAudit(tx, {
      action: 'practitioner.standing_recorded',
      entityType: 'practitioners.professional_registrations',
      entityId: saved.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.userId,
      before: { cadreLevelId: existing.cadreLevelId, registrationCategoryId: existing.registrationCategoryId },
      after: { cadreLevelId: saved.cadreLevelId, registrationCategoryId: saved.registrationCategoryId },
    });

    return toRegistrationView(saved);
  });
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
