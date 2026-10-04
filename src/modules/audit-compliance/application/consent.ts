import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import {
  BASIS_FOR_PURPOSE,
  isWithdrawable,
  type ConsentPurposeValue,
  type LawfulBasisValue,
} from '../domain/consent';

/**
 * Consent, and the agreements somebody has accepted.
 *
 * Both are append-only. A withdrawal is a new record, not an edit of the old
 * one — "they consented in March and withdrew in June" is the answer a
 * regulator asks for, and an UPDATE would leave only the second half of it.
 */

export const ConsentErrors = {
  notWithdrawable: (purpose: string, basis: string) =>
    new HttpError(
      'consent_not_withdrawable',
      `${purpose} is processed under ${basis.toLowerCase().replace('_', ' ')}, not consent, so it cannot be withdrawn. The record explains why.`,
      409,
    ),
  reasonRequired: () =>
    new HttpError('withdrawal_reason_required', 'Say why you are withdrawing it.', 422),
  agreementNotFound: () =>
    new HttpError('agreement_not_found', 'That agreement version does not exist.', 404),
  alreadyAccepted: () =>
    new HttpError('agreement_already_accepted', 'You have already accepted that version.', 409),
};

export interface ConsentView {
  purpose: ConsentPurposeValue;
  granted: boolean;
  lawfulBasis: LawfulBasisValue;
  withdrawable: boolean;
  grantedAt: Date;
  withdrawnAt: Date | null;
  note: string | null;
}

/**
 * Where each purpose currently stands for one person.
 *
 * Derived from the latest record per purpose rather than stored as a flag: a
 * flag would be a second place the truth lives, and the history is the thing
 * that actually answers "when did they agree to this".
 */
export async function currentConsent(userId: string): Promise<ConsentView[]> {
  const rows = await prisma.consentRecord.findMany({
    where: { userId },
    orderBy: { grantedAt: 'desc' },
  });

  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.purpose)) latest.set(row.purpose, row);

  return (Object.keys(BASIS_FOR_PURPOSE) as ConsentPurposeValue[]).map((purpose) => {
    const row = latest.get(purpose);
    return {
      purpose,
      granted: row?.granted ?? false,
      lawfulBasis: (row?.lawfulBasis ?? BASIS_FOR_PURPOSE[purpose]) as LawfulBasisValue,
      withdrawable: isWithdrawable(purpose),
      grantedAt: row?.grantedAt ?? new Date(0),
      withdrawnAt: row?.withdrawnAt ?? null,
      note: row?.note ?? null,
    };
  });
}

export async function recordConsent(input: {
  userId: string;
  purpose: ConsentPurposeValue;
  granted: boolean;
  note?: string;
  actorId: string;
}): Promise<ConsentView[]> {
  const basis = BASIS_FOR_PURPOSE[input.purpose];

  // Withdrawing something that never rested on consent is not a thing the
  // platform can honour, and saying so is better than accepting the click and
  // carrying on regardless.
  if (!input.granted && !isWithdrawable(input.purpose)) {
    throw ConsentErrors.notWithdrawable(input.purpose, basis);
  }
  if (!input.granted && !input.note?.trim()) throw ConsentErrors.reasonRequired();

  await prisma.$transaction(async (tx: Tx) => {
    const created = await tx.consentRecord.create({
      data: {
        userId: input.userId,
        purpose: input.purpose,
        granted: input.granted,
        lawfulBasis: basis,
        withdrawnAt: input.granted ? null : new Date(),
        note: input.note,
      },
    });

    await recordAudit(tx, {
      action: input.granted ? 'consent.granted' : 'consent.withdrawn',
      entityType: 'consent.consent_records',
      entityId: created.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.userId,
      reason: input.note,
      after: { purpose: input.purpose, granted: input.granted, lawfulBasis: basis },
    });
  });

  return currentConsent(input.userId);
}

export interface AgreementView {
  id: string;
  kind: string;
  identifier: string;
  title: string;
  body: string;
  effectiveFrom: Date;
  acceptedAt: Date | null;
}

/** Who an agreement binds. A privacy notice binds everybody; the rest do not. */
export type AgreementAudience = 'PRACTITIONER' | 'FACILITY';

const KINDS_BINDING: Record<AgreementAudience, string[]> = {
  PRACTITIONER: ['PRACTITIONER_ENGAGEMENT', 'PRIVACY_NOTICE'],
  FACILITY: ['FACILITY_TERMS', 'PRIVACY_NOTICE'],
};

/**
 * The current version of each agreement that binds this audience, with whether
 * this person has accepted it.
 *
 * A retired version is excluded: somebody signing up today agrees to what is
 * in force today. What they agreed to *before* is in their acceptances and
 * stays readable there.
 *
 * `audience` is required rather than defaulted. Unfiltered, this returned
 * every kind to everybody, so each practitioner's "Your data" page listed the
 * hospital's terms of service as an outstanding obligation with a working
 * "I agree" button — an obligation they could never discharge, because it was
 * never theirs, sitting beside the one agreement they genuinely did owe.
 */
export async function currentAgreements(
  userId: string,
  audience: AgreementAudience,
): Promise<AgreementView[]> {
  const versions = await prisma.agreementVersion.findMany({
    where: {
      retiredAt: null,
      effectiveFrom: { lte: new Date() },
      kind: { in: KINDS_BINDING[audience] as never[] },
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  const acceptances = await prisma.agreementAcceptance.findMany({
    where: { userId, versionId: { in: versions.map((row) => row.id) } },
  });
  const acceptedAt = new Map(acceptances.map((row) => [row.versionId, row.acceptedAt]));

  // One per kind: the most recent in force.
  const seen = new Set<string>();
  const current: AgreementView[] = [];
  for (const version of versions) {
    if (seen.has(version.kind)) continue;
    seen.add(version.kind);
    current.push({
      id: version.id,
      kind: version.kind,
      identifier: version.identifier,
      title: version.title,
      body: version.body,
      effectiveFrom: version.effectiveFrom,
      acceptedAt: acceptedAt.get(version.id) ?? null,
    });
  }
  return current;
}

export async function acceptAgreement(input: {
  userId: string;
  versionId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ accepted: true; identifier: string }> {
  const version = await prisma.agreementVersion.findUnique({ where: { id: input.versionId } });
  if (!version || version.retiredAt) throw ConsentErrors.agreementNotFound();

  const existing = await prisma.agreementAcceptance.findUnique({
    where: { userId_versionId: { userId: input.userId, versionId: input.versionId } },
  });
  if (existing) throw ConsentErrors.alreadyAccepted();

  await prisma.$transaction(async (tx: Tx) => {
    const created = await tx.agreementAcceptance.create({
      data: {
        userId: input.userId,
        versionId: input.versionId,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });

    await recordAudit(tx, {
      action: 'agreement.accepted',
      entityType: 'consent.agreement_acceptances',
      entityId: created.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      // The identifier, not the title: a title can be edited and a version
      // identifier is the thing that pins down what was agreed.
      after: { identifier: version.identifier, kind: version.kind },
    });
  });

  return { accepted: true, identifier: version.identifier };
}

/** Publishing a new version retires the one it replaces, in one transaction. */
export async function publishAgreement(input: {
  kind: 'PRACTITIONER_ENGAGEMENT' | 'FACILITY_TERMS' | 'PRIVACY_NOTICE';
  identifier: string;
  title: string;
  body: string;
  effectiveFrom?: Date;
  actorId: string;
}): Promise<AgreementView> {
  const effectiveFrom = input.effectiveFrom ?? new Date();

  return prisma.$transaction(async (tx: Tx) => {
    await tx.agreementVersion.updateMany({
      where: { kind: input.kind, retiredAt: null },
      data: { retiredAt: effectiveFrom },
    });

    const created = await tx.agreementVersion.create({
      data: {
        kind: input.kind,
        identifier: input.identifier,
        title: input.title,
        body: input.body,
        effectiveFrom,
        publishedBy: input.actorId,
      },
    });

    await recordAudit(tx, {
      action: 'agreement.published',
      entityType: 'consent.agreement_versions',
      entityId: created.id,
      actorId: input.actorId,
      scopeType: 'PLATFORM',
      after: { identifier: created.identifier, kind: created.kind },
    });

    return {
      id: created.id,
      kind: created.kind,
      identifier: created.identifier,
      title: created.title,
      body: created.body,
      effectiveFrom: created.effectiveFrom,
      acceptedAt: null,
    };
  });
}
