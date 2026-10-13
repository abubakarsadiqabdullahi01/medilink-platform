import { prisma, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import { assertUploadAllowed, createDownloadUrl, createUploadUrl } from '@/lib/storage/tigris';
import { getAssignment } from '@/modules/matching/application/assignment';
import { DisputeErrors, sideOnCase, type CaseSide } from './dispute';

/**
 * Evidence attached to a case.
 *
 * The file goes to Tigris under the `dispute_evidence` purpose and only its
 * key is recorded here, which is the convention the schema header states and
 * the credential documents already follow.
 *
 * **Either party may attach, and neither may remove.** A dispute where one
 * side can withdraw an inconvenient photograph after the other has seen it is
 * not a record of anything. Evidence is append-only for the same reason
 * `checkin_events` and `timesheet_revisions` are.
 */

export const EvidenceErrors = {
  notLive: () =>
    new HttpError(
      'dispute_not_live',
      'Evidence can only be attached while a dispute is open.',
      409,
    ),

  notAParty: () =>
    new HttpError('dispute_not_a_party', 'Only a party to this shift may attach evidence.', 403),

  notFound: () => new HttpError('evidence_not_found', 'That evidence does not exist.', 404),
};

/**
 * The case, if the viewer has any part in it.
 *
 * `dispute.manage` alone says nothing about *this* case, so every function
 * below asks where the caller stands on it first. Somebody with no part gets
 * "not found" — the answer an id that does not exist would get — rather than a
 * 403 that confirms the case is there.
 */
async function caseFor(disputeId: string, viewerId: string) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw DisputeErrors.notFound();

  const assignment = await getAssignment(dispute.assignmentId);
  if (!assignment) throw DisputeErrors.notFound();

  const side: CaseSide | null = await sideOnCase(viewerId, assignment);
  if (side === null) throw DisputeErrors.notFound();

  return { dispute, side };
}

/**
 * A case somebody may add evidence to: they are one of its two sides, and it
 * is still being argued. The adjudicator can see everything and is refused
 * here by name — they weigh the evidence, they do not produce it, and
 * `attachedBySide` below has only two values because of it.
 */
async function caseOpenToEvidence(disputeId: string, userId: string) {
  const { dispute, side } = await caseFor(disputeId, userId);
  if (side === 'ADJUDICATOR') throw EvidenceErrors.notAParty();
  if (dispute.status !== 'OPEN' && dispute.status !== 'UNDER_REVIEW') throw EvidenceErrors.notLive();
  return dispute;
}

export interface EvidenceView {
  id: string;
  disputeId: string;
  objectKey: string;
  attachedBy: string;
  note: string | null;
  createdAt: Date;
}

function toView(row: EvidenceView): EvidenceView {
  return {
    id: row.id,
    disputeId: row.disputeId,
    objectKey: row.objectKey,
    attachedBy: row.attachedBy,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export interface EvidenceUploadUrl {
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

/**
 * A signed URL the browser uploads straight to, so the file never passes
 * through this application. The `StoredObject` row is written now and the
 * evidence row only once the upload is claimed, so an abandoned upload leaves
 * an orphan object rather than an evidence record pointing at nothing.
 */
export async function requestEvidenceUploadUrl(input: {
  disputeId: string;
  userId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<EvidenceUploadUrl> {
  assertUploadAllowed(input.contentType, input.sizeBytes);

  await caseOpenToEvidence(input.disputeId, input.userId);

  const { objectKey, url, expiresInSeconds } = await createUploadUrl({
    purpose: 'dispute_evidence',
    ownerId: input.userId,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  await prisma.$transaction(async (tx: Tx) => {
    const stored = await tx.storedObject.create({
      data: {
        bucket: env.STORAGE_BUCKET,
        objectKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        purpose: 'dispute_evidence',
        ownerUserId: input.userId,
        scopeType: 'SELF',
        scopeId: input.userId,
      },
    });

    await recordAudit(tx, {
      action: 'dispute.evidence_upload_requested',
      entityType: 'storage.stored_objects',
      entityId: stored.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      after: { disputeId: input.disputeId, objectKey, sizeBytes: input.sizeBytes },
    });
  });

  return { objectKey, uploadUrl: url, expiresInSeconds };
}

/**
 * Claims an uploaded object as evidence on the case.
 *
 * The object has to exist and to belong to the person claiming it, or one
 * party could attach another's file by guessing a key.
 */
export async function attachEvidence(input: {
  disputeId: string;
  userId: string;
  objectKey: string;
  note?: string;
}): Promise<EvidenceView> {
  await caseOpenToEvidence(input.disputeId, input.userId);

  const stored = await prisma.storedObject.findUnique({ where: { objectKey: input.objectKey } });
  if (!stored || stored.purpose !== 'dispute_evidence') throw EvidenceErrors.notFound();
  if (stored.ownerUserId !== input.userId) throw EvidenceErrors.notFound();

  return prisma.$transaction(async (tx: Tx) => {
    await tx.storedObject.update({
      where: { id: stored.id },
      data: { uploadedAt: stored.uploadedAt ?? new Date() },
    });

    const row = await tx.disputeEvidence.create({
      data: {
        disputeId: input.disputeId,
        objectKey: input.objectKey,
        attachedBy: input.userId,
        note: input.note,
      },
    });

    await recordAudit(tx, {
      action: 'dispute.evidence_attached',
      entityType: 'disputes.dispute_evidence',
      entityId: row.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      after: { disputeId: input.disputeId, objectKey: input.objectKey },
    });

    return toView(row);
  });
}

/**
 * Everything attached to the case, oldest first, with who attached it.
 *
 * `attachedBy` is a uuid on the row and an adjudicator cannot weigh a
 * photograph without knowing which side produced it — a ward picture from the
 * facility and the same picture from the practitioner are different evidence.
 * Chronological order is kept because a dispute is an argument and the order
 * things were said in is part of it.
 *
 * The side is derived rather than stored: the dispute already knows whose
 * assignment it is and which facility, so asking the row would have meant
 * trusting a second copy of the same fact.
 */
export interface EvidenceItem extends EvidenceView {
  attachedByName: string;
  /**
   * Only ever one of two: `attachEvidence` refuses anybody who is not a party
   * to the shift, so there is no third case to represent.
   */
  attachedBySide: 'PRACTITIONER' | 'FACILITY';
}

/**
 * Callers authorise first — both routes that reach it are PLATFORM-scoped.
 */
export async function listEvidence(disputeId: string): Promise<EvidenceItem[]> {
  const [rows, dispute] = await Promise.all([
    prisma.disputeEvidence.findMany({
      where: { disputeId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.dispute.findUnique({
      where: { id: disputeId },
      select: { assignment: { select: { userId: true } } },
    }),
  ]);

  if (rows.length === 0) return [];

  const practitionerId = dispute?.assignment.userId ?? null;

  const people = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.attachedBy))] } },
    select: { id: true, fullName: true },
  });
  const names = new Map(people.map((person) => [person.id, person.fullName]));

  return rows.map((row) => ({
    ...toView(row),
    attachedByName: names.get(row.attachedBy) ?? row.attachedBy.slice(0, 8),
    attachedBySide:
      row.attachedBy === practitionerId
        ? ('PRACTITIONER' as const)
        : ('FACILITY' as const),
  }));
}

/**
 * A short-lived link to one piece of evidence.
 *
 * Issued per read and audited, because a dispute's evidence is the most
 * sensitive thing this module holds — a photograph of a ward, a medical
 * letter — and a permanent URL would outlive any reason to hold it.
 */
export async function requestEvidenceDownloadUrl(input: {
  disputeId: string;
  evidenceId: string;
  viewerId: string;
}): Promise<{ url: string }> {
  // Either side of the shift or an adjudicator, and the evidence has to be on
  // the case named: the path carries both ids so a caller cannot name their
  // own case and somebody else's photograph.
  await caseFor(input.disputeId, input.viewerId);

  const row = await prisma.disputeEvidence.findFirst({
    where: { id: input.evidenceId, disputeId: input.disputeId },
  });
  if (!row) throw EvidenceErrors.notFound();

  const url = await createDownloadUrl(row.objectKey);

  await recordAudit(prisma, {
    action: 'dispute.evidence_read',
    entityType: 'disputes.dispute_evidence',
    entityId: row.id,
    actorId: input.viewerId,
    scopeType: 'SELF',
    scopeId: input.viewerId,
    after: { disputeId: row.disputeId },
  });

  return { url };
}
