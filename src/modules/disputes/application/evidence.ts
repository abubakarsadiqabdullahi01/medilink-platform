import { prisma, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import { assertUploadAllowed, createDownloadUrl, createUploadUrl } from '@/lib/storage/tigris';
import { DisputeErrors } from './dispute';

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

  const dispute = await prisma.dispute.findUnique({ where: { id: input.disputeId } });
  if (!dispute) throw DisputeErrors.notFound();
  if (dispute.status !== 'OPEN' && dispute.status !== 'UNDER_REVIEW') throw EvidenceErrors.notLive();

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
  const dispute = await prisma.dispute.findUnique({ where: { id: input.disputeId } });
  if (!dispute) throw DisputeErrors.notFound();
  if (dispute.status !== 'OPEN' && dispute.status !== 'UNDER_REVIEW') throw EvidenceErrors.notLive();

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

/** Everything attached to the case, oldest first. */
export async function listEvidence(disputeId: string): Promise<EvidenceView[]> {
  const rows = await prisma.disputeEvidence.findMany({
    where: { disputeId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toView);
}

/**
 * A short-lived link to one piece of evidence.
 *
 * Issued per read and audited, because a dispute's evidence is the most
 * sensitive thing this module holds — a photograph of a ward, a medical
 * letter — and a permanent URL would outlive any reason to hold it.
 */
export async function requestEvidenceDownloadUrl(input: {
  evidenceId: string;
  viewerId: string;
}): Promise<{ url: string }> {
  const row = await prisma.disputeEvidence.findUnique({ where: { id: input.evidenceId } });
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
