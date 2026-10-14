import { Prisma } from '@prisma/client';
import { returnApplicationForChanges } from '@/modules/practitioners/application/application-review';
import { prisma, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { publishEvent } from '@/lib/outbox';
import { EVENTS } from '@/lib/events';
import { createDownloadUrl, createUploadUrl, headObject } from '@/lib/storage/tigris';
import {
  expiryFor,
  printedExpiryProblem,
  holdsNin,
  maskReference,
  requiredEvidenceFor,
} from '../domain/submission';
import { CredentialErrors } from '../domain/errors';

/**
 * The credential-submission aggregate: submit, list, review, and the
 * document upload/download flow around it. One file, matching
 * practitioners/application/profile.ts's precedent.
 */

export type CredentialSubmissionStatusValue =
  | 'PENDING'
  | 'MORE_INFO_REQUESTED'
  | 'VERIFIED'
  | 'REJECTED'
  // Set only by the Step 5.9 expiry sweep (src/modules/credentials/application/expiry.ts),
  // never by this file — included here so toView accepts a row the sweep touched.
  | 'EXPIRED';

export interface CredentialSubmissionView {
  id: string;
  userId: string;
  credentialTypeId: string;
  status: CredentialSubmissionStatusValue;
  referenceNumber: string | null;
  documentObjectKey: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  /** The instant it stops counting. */
  expiresAt: Date | null;
  /**
   * The date printed on the document, as the reviewer read it, as `YYYY-MM-DD`.
   * Null when none was read and `expiresAt` is only an estimate from the type's
   * review interval; a screen says which it is showing.
   */
  documentExpiresOn: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A queue row: the submission, plus who it belongs to and what it is.
 *
 * The list used to return ids and nothing else, so the review screen showed
 * `67ddc9b6` where a name belongs and `efcd5329` where "MBBS" belongs. An
 * officer could not tell two practitioners apart, or two credential types,
 * without going to the database. For the one step in this product whose whole
 * purpose is a person looking at evidence by hand, that is the wrong shape.
 *
 * The photograph is signed here rather than fetched per row: a review queue is
 * short, signing is local, and one request that arrives complete beats a
 * screen that fills in faces afterwards. Each practitioner is signed once even
 * when they have several submissions in the same queue.
 */
export interface CredentialQueueRow extends CredentialSubmissionView {
  practitionerName: string;
  practitionerPhone: string;
  practitionerPhotoUrl: string | null;
  credentialTypeName: string;
  /**
   * How this one is checked. A queue that offers "Verify" on a NIN and "Verify"
   * on a certificate is offering two different acts under one word, so the
   * screen needs to know which it is looking at.
   */
  verificationMethod: string;
  /** Whether it has an expiry date at all, so a screen knows whether to ask for one. */
  credentialTypeExpires: boolean;
}

/**
 * What an audit row may say about a submission. The reference on a NIN is the
 * NIN, and the trail is append-only and read by more people than the record, so
 * it carries only the last four digits.
 */
function auditView(view: CredentialSubmissionView, verificationMethod: string) {
  if (!holdsNin(verificationMethod) || !view.referenceNumber) return view;
  return { ...view, referenceNumber: maskReference(view.referenceNumber) };
}

function toView(submission: {
  id: string;
  userId: string;
  credentialTypeId: string;
  status: CredentialSubmissionStatusValue;
  referenceNumber: string | null;
  documentObjectKey: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  expiresAt: Date | null;
  documentExpiresOn: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CredentialSubmissionView {
  return {
    id: submission.id,
    userId: submission.userId,
    credentialTypeId: submission.credentialTypeId,
    status: submission.status,
    referenceNumber: submission.referenceNumber,
    documentObjectKey: submission.documentObjectKey,
    reviewedBy: submission.reviewedBy,
    reviewedAt: submission.reviewedAt,
    reviewNotes: submission.reviewNotes,
    expiresAt: submission.expiresAt,
    documentExpiresOn: submission.documentExpiresOn?.toISOString().slice(0, 10) ?? null,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  };
}

/**
 * Confirms the client actually finished uploading before a submission is
 * allowed to reference the object — a network call, so it stays outside any
 * transaction, same reasoning as "codes are sent after the transaction
 * commits" in the auth module.
 */
async function confirmDocumentOwnership(userId: string, objectKey: string): Promise<void> {
  const stored = await prisma.storedObject.findUnique({ where: { objectKey } });
  if (
    !stored ||
    stored.ownerUserId !== userId ||
    stored.purpose !== 'credential_document' ||
    stored.deletedAt
  ) {
    throw CredentialErrors.invalidDocumentReference();
  }
  try {
    await headObject(objectKey);
  } catch {
    throw CredentialErrors.invalidDocumentReference();
  }
}

/**
 * Marks the StoredObject uploaded, with its own audit row — separate from
 * the submission's own row, and separate from the upload-url request's row,
 * because confirmation can happen in a later, unrelated request.
 */
async function confirmDocumentUpload(tx: Tx, userId: string, objectKey: string): Promise<void> {
  const updated = await tx.storedObject.update({
    where: { objectKey },
    data: { uploadedAt: new Date() },
  });

  await recordAudit(tx, {
    action: 'credential.document_confirmed',
    entityType: 'storage.stored_objects',
    entityId: updated.id,
    actorId: userId,
    scopeType: 'SELF',
    scopeId: userId,
  });
}

export interface SubmitCredentialParams {
  userId: string;
  credentialTypeId: string;
  referenceNumber?: string;
  documentObjectKey?: string;
}

export async function submitCredential(
  input: SubmitCredentialParams,
): Promise<CredentialSubmissionView> {
  const credentialType = await prisma.credentialType.findUnique({
    where: { id: input.credentialTypeId },
  });
  if (!credentialType) throw CredentialErrors.credentialTypeNotFound();

  const required = requiredEvidenceFor(credentialType.verificationMethod);
  if (required === 'reference_number' && !input.referenceNumber) {
    throw CredentialErrors.referenceNumberRequired();
  }
  if (required === 'document' && !input.documentObjectKey) {
    throw CredentialErrors.documentRequired();
  }

  // Best-effort, not a hard guarantee: there is no partial unique index
  // backing this (Prisma's schema DSL cannot express one, and hand-writing
  // one into the migration would drift the next time anyone runs `migrate
  // dev`). A genuinely concurrent double-submit of the same type can still
  // race past this check; worst case a reviewer sees two PENDING rows for
  // the same type and rejects the extra one.
  const existingActive = await prisma.credentialSubmission.findFirst({
    where: {
      userId: input.userId,
      credentialTypeId: input.credentialTypeId,
      // MORE_INFO_REQUESTED counts as active: the practitioner should
      // resupply on the existing row, not open a second one the reviewer
      // then has to reconcile.
      status: { in: ['PENDING', 'MORE_INFO_REQUESTED', 'VERIFIED'] },
      deletedAt: null,
    },
  });
  if (existingActive) throw CredentialErrors.duplicateActiveSubmission();

  if (input.documentObjectKey) {
    await confirmDocumentOwnership(input.userId, input.documentObjectKey);
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.credentialSubmission.create({
      data: {
        userId: input.userId,
        credentialTypeId: input.credentialTypeId,
        referenceNumber: input.referenceNumber,
        documentObjectKey: input.documentObjectKey,
      },
    });

    if (input.documentObjectKey) {
      await confirmDocumentUpload(tx, input.userId, input.documentObjectKey);
    }

    await recordAudit(tx, {
      action: 'credential.submitted',
      entityType: 'credentials.credential_submissions',
      entityId: created.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      after: auditView(toView(created), credentialType.verificationMethod),
    });

    await publishEvent(tx, {
      eventType: EVENTS.CredentialSubmitted,
      aggregateType: 'credentials.credential_submissions',
      aggregateId: created.id,
      payload: {
        submissionId: created.id,
        userId: input.userId,
        credentialTypeId: input.credentialTypeId,
      },
    });

    return toView(created);
  });
}

export interface ListSubmissionsQuery {
  scopeType: 'SELF' | 'PLATFORM';
  scopeId?: string;
  status?: CredentialSubmissionStatusValue;
  credentialTypeId?: string;
  search?: string;
  limit: number;
  cursor?: string;
}

export interface SubmissionsPage {
  submissions: CredentialQueueRow[];
  nextCursor: string | null;
}

/** Filter derivation mirrors readAuditTrail exactly, adapted to a userId column. */
export async function listSubmissions(query: ListSubmissionsQuery): Promise<SubmissionsPage> {
  const where: Prisma.CredentialSubmissionWhereInput = { deletedAt: null };

  // SELF is confined to the caller's own id (defaulted upstream, same as the
  // audit route); PLATFORM applies no owner filter unless one is given — an
  // optional narrowing to a single practitioner for a reviewer's lookup.
  if (query.scopeType !== 'PLATFORM' || query.scopeId) {
    where.userId = query.scopeId;
  }

  if (query.status) where.status = query.status;
  if (query.credentialTypeId) where.credentialTypeId = query.credentialTypeId;

  if (query.search) {
    const search = query.search.trim();
    where.user = {
      OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    };
  }

  const rows = await prisma.credentialSubmission.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: {
      user: {
        select: {
          fullName: true,
          phone: true,
          practitionerProfile: { select: { photoObjectKey: true } },
        },
      },
      credentialType: { select: { name: true, verificationMethod: true, expires: true } },
    },
  });

  const page = rows.slice(0, query.limit);

  // One signature per practitioner, not per submission: somebody with three
  // credentials in the queue is still one face.
  const signed = new Map<string, string | null>();
  for (const row of page) {
    const key = row.user.practitionerProfile?.photoObjectKey ?? null;
    if (!signed.has(row.userId)) {
      signed.set(row.userId, key ? await createDownloadUrl(key) : null);
    }
  }

  const submissions: CredentialQueueRow[] = page.map((row) => ({
    ...toView(row),
    practitionerName: row.user.fullName,
    practitionerPhone: row.user.phone,
    practitionerPhotoUrl: signed.get(row.userId) ?? null,
    credentialTypeName: row.credentialType.name,
    verificationMethod: row.credentialType.verificationMethod,
    credentialTypeExpires: row.credentialType.expires,
  }));

  const hasMore = rows.length > query.limit;

  return {
    submissions,
    nextCursor: hasMore ? (submissions[submissions.length - 1]?.id ?? null) : null,
  };
}

export type ReviewDecision = 'approve' | 'reject' | 'request_info';

export interface ReviewCredentialParams {
  submissionId: string;
  reviewerId: string;
  decision: ReviewDecision;
  reviewNotes?: string;
  /**
   * The expiry date printed on the document, `YYYY-MM-DD`, read by the reviewer.
   * Only on approval, and only for a credential that expires.
   */
  printedExpiryDate?: string;
}

const DECISION_STATUS: Record<ReviewDecision, CredentialSubmissionStatusValue> = {
  approve: 'VERIFIED',
  reject: 'REJECTED',
  request_info: 'MORE_INFO_REQUESTED',
};

const DECISION_ACTION: Record<ReviewDecision, string> = {
  approve: 'credential.verified',
  reject: 'credential.rejected',
  request_info: 'credential.info_requested',
};

export async function reviewCredential(
  input: ReviewCredentialParams,
): Promise<CredentialSubmissionView> {
  const existing = await prisma.credentialSubmission.findUnique({
    where: { id: input.submissionId },
    include: { credentialType: true },
  });
  if (!existing || existing.deletedAt) throw CredentialErrors.submissionNotFound();
  if (existing.userId === input.reviewerId) throw CredentialErrors.cannotReviewOwnSubmission();
  if (existing.status !== 'PENDING') throw CredentialErrors.alreadyReviewed();

  const now = new Date();
  const approved = input.decision === 'approve';
  const nextStatus = DECISION_STATUS[input.decision];

  // The date printed on the document governs; the type's review interval is only
  // the fallback when nobody read one (CRE-04). Refused before anything is written.
  if (input.printedExpiryDate !== undefined && !approved) {
    throw CredentialErrors.printedExpiryInvalid('only_when_approving');
  }
  const problem = approved
    ? printedExpiryProblem(existing.credentialType, input.printedExpiryDate, now)
    : null;
  if (problem) throw CredentialErrors.printedExpiryInvalid(problem);
  const { expiresAt, documentExpiresOn } = approved
    ? expiryFor(existing.credentialType, now, input.printedExpiryDate)
    : { expiresAt: null, documentExpiresOn: null };

  // A NIN is not kept whole once anybody has decided anything about it. It was
  // masked only on the confirmed path, so a rejected, queried or mismatched
  // submission kept the whole number for good; a practitioner who has to send
  // it again is asked for it again.
  const maskedReference =
    holdsNin(existing.credentialType.verificationMethod) && existing.referenceNumber
      ? maskReference(existing.referenceNumber)
      : null;

  return prisma.$transaction(async (tx) => {
    const review = await tx.credentialSubmission.updateMany({
      where: { id: input.submissionId, status: 'PENDING' },
      data: {
        status: nextStatus,
        reviewedBy: input.reviewerId,
        reviewedAt: now,
        reviewNotes: input.reviewNotes,
        expiresAt,
        documentExpiresOn: documentExpiresOn ? new Date(`${documentExpiresOn}T00:00:00.000Z`) : null,
        ...(maskedReference ? { referenceNumber: maskedReference } : {}),
      },
    });
    if (review.count !== 1) throw CredentialErrors.alreadyReviewed();

    const updated = await tx.credentialSubmission.findUniqueOrThrow({
      where: { id: input.submissionId },
    });

    // Scoped to the submitting practitioner, not the reviewer: this row is
    // about the practitioner's own credential, and they must be able to see
    // it in their own SELF-scoped audit history. actorId is who actually
    // did it — the two are deliberately different people here.
    await recordAudit(tx, {
      action: DECISION_ACTION[input.decision],
      entityType: 'credentials.credential_submissions',
      entityId: updated.id,
      actorId: input.reviewerId,
      scopeType: 'SELF',
      scopeId: existing.userId,
      reason: input.reviewNotes,
      before: auditView(toView(existing), existing.credentialType.verificationMethod),
      after: auditView(toView(updated), existing.credentialType.verificationMethod),
    });

    // A refusal of something the profession requires sends the application
    // back to the practitioner, who must fix it and submit again.
    if (input.decision === 'reject') {
      await returnApplicationForChanges(tx, {
        userId: existing.userId,
        credentialTypeId: existing.credentialTypeId,
        reviewerId: input.reviewerId,
        reason: input.reviewNotes,
      });
    }

    // Every decision is an event, so the practitioner is told what an officer
    // decided about their document (CRE-07). The audit row above is the record;
    // the event is what reaches a person. The notes stay on the audit row and in
    // the app; the event carries no free text.
    await publishEvent(tx, {
      eventType: {
        approve: EVENTS.CredentialVerified,
        reject: EVENTS.CredentialRejected,
        request_info: EVENTS.CredentialInfoRequested,
      }[input.decision],
      aggregateType: 'credentials.credential_submissions',
      aggregateId: updated.id,
      payload: {
        submissionId: updated.id,
        userId: updated.userId,
        credentialTypeId: updated.credentialTypeId,
        // A submission can be queried more than once; this is what makes the
        // second query a new thing to be told about, not a repeat of the first.
        decidedAt: now.toISOString(),
      },
    });

    return toView(updated);
  });
}

export interface ResupplyCredentialParams {
  submissionId: string;
  userId: string;
  referenceNumber?: string;
  documentObjectKey?: string;
}

/**
 * The practitioner's answer to a request for more information. The row
 * returns to PENDING for the reviewer to pick up again.
 *
 * Reachable only from MORE_INFO_REQUESTED. This is deliberately not a general
 * edit path for a PENDING submission — 5.2's doc left that out on purpose,
 * and allowing it would mean a reviewer could be looking at one version of a
 * submission while the practitioner replaces it underneath them.
 *
 * A submission belonging to someone else is 404, not 403: ownership is folded
 * into the lookup, because the guard has no way to know whose submission an
 * id is before reading it, and a distinguishable 403 would confirm that a
 * particular id exists.
 */
export async function resupplyCredential(
  input: ResupplyCredentialParams,
): Promise<CredentialSubmissionView> {
  const existing = await prisma.credentialSubmission.findFirst({
    where: { id: input.submissionId, userId: input.userId, deletedAt: null },
    include: { credentialType: true },
  });
  if (!existing) throw CredentialErrors.submissionNotFound();
  if (existing.status !== 'MORE_INFO_REQUESTED') throw CredentialErrors.notAwaitingInformation();

  // A NIN was masked when it was decided on, so what is stored is not a number
  // anybody can use: they have to type it again.
  const keptReference = holdsNin(existing.credentialType.verificationMethod)
    ? null
    : existing.referenceNumber;
  const referenceNumber = input.referenceNumber ?? keptReference;
  const documentObjectKey = input.documentObjectKey ?? existing.documentObjectKey;

  // The same evidence rule as the original submission: what the credential
  // type needs does not change because a reviewer asked a question.
  const required = requiredEvidenceFor(existing.credentialType.verificationMethod);
  if (required === 'reference_number' && !referenceNumber) {
    throw CredentialErrors.referenceNumberRequired();
  }
  if (required === 'document' && !documentObjectKey) throw CredentialErrors.documentRequired();

  if (input.documentObjectKey) {
    await confirmDocumentOwnership(input.userId, input.documentObjectKey);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.credentialSubmission.update({
      where: { id: existing.id },
      data: {
        referenceNumber,
        documentObjectKey,
        status: 'PENDING',
        // Cleared: they described the request, and the request has been
        // answered. What was asked survives on the audit row.
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
      },
    });

    if (input.documentObjectKey) {
      await confirmDocumentUpload(tx, input.userId, input.documentObjectKey);
    }

    await recordAudit(tx, {
      action: 'credential.resupplied',
      entityType: 'credentials.credential_submissions',
      entityId: updated.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      before: auditView(toView(existing), existing.credentialType.verificationMethod),
      after: auditView(toView(updated), existing.credentialType.verificationMethod),
    });

    return toView(updated);
  });
}

/**
 * What the confirmation flow needs to know about a submission before it writes
 * anything: whose it is, what it is, whether it is still waiting, and what the
 * practitioner supplied.
 */
export interface SubmissionForVerification {
  id: string;
  userId: string;
  status: CredentialSubmissionStatusValue;
  referenceNumber: string | null;
  documentObjectKey: string | null;
  credentialTypeName: string;
  verificationMethod: string;
  /** Whether this kind of credential has an expiry date at all. */
  credentialTypeExpires: boolean;
}

export async function getSubmissionForVerification(
  submissionId: string,
): Promise<SubmissionForVerification> {
  const row = await prisma.credentialSubmission.findUnique({
    where: { id: submissionId },
    include: { credentialType: { select: { name: true, verificationMethod: true, expires: true } } },
  });
  if (!row || row.deletedAt) throw CredentialErrors.submissionNotFound();
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    referenceNumber: row.referenceNumber,
    documentObjectKey: row.documentObjectKey,
    credentialTypeName: row.credentialType.name,
    verificationMethod: row.credentialType.verificationMethod,
    credentialTypeExpires: row.credentialType.expires,
  };
}

/**
 * Once an identity has been recorded from a NIN the number has done its job:
 * the identity record keeps a digest and the last four, and this keeps the same.
 * Left whole it would be the one place in the system that still held somebody's
 * NIN in the clear.
 */
export async function maskSubmissionReference(input: {
  submissionId: string;
  actorId: string;
}): Promise<void> {
  const existing = await prisma.credentialSubmission.findUnique({
    where: { id: input.submissionId },
  });
  if (!existing?.referenceNumber) return;

  const masked = maskReference(existing.referenceNumber);
  if (masked === existing.referenceNumber) return;

  await prisma.$transaction(async (tx) => {
    await tx.credentialSubmission.update({
      where: { id: existing.id },
      data: { referenceNumber: masked },
    });
    await recordAudit(tx, {
      action: 'credential.reference_masked',
      entityType: 'credentials.credential_submissions',
      entityId: existing.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: existing.userId,
      reason: 'Identity recorded; the number is no longer held in full.',
      after: { referenceNumber: masked },
    });
  });
}

export interface RequestDocumentUploadUrlParams {
  userId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface DocumentUploadUrl {
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export async function requestDocumentUploadUrl(
  input: RequestDocumentUploadUrlParams,
): Promise<DocumentUploadUrl> {
  const { objectKey, url, expiresInSeconds } = await createUploadUrl({
    purpose: 'credential_document',
    ownerId: input.userId,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  await prisma.$transaction(async (tx) => {
    const stored = await tx.storedObject.create({
      data: {
        bucket: env.STORAGE_BUCKET,
        objectKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        purpose: 'credential_document',
        ownerUserId: input.userId,
        scopeType: 'SELF',
        scopeId: input.userId,
      },
    });

    await recordAudit(tx, {
      action: 'credential.document_upload_requested',
      entityType: 'storage.stored_objects',
      entityId: stored.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      after: { objectKey, contentType: input.contentType, sizeBytes: input.sizeBytes },
    });
  });

  return { objectKey, uploadUrl: url, expiresInSeconds };
}

export interface RequestDocumentDownloadUrlParams {
  submissionId: string;
  scopeType: 'SELF' | 'PLATFORM';
  scopeId?: string;
  viewerId: string;
}

export interface DocumentDownloadUrl {
  downloadUrl: string;
  expiresInSeconds: number;
}

/**
 * A submission that exists but belongs to someone else at SELF scope is 404,
 * not 403 — guarded-handler.ts's own stated reasoning applies exactly here
 * ("a distinguishable 403 and 404 is a directory"): a 403 would confirm to a
 * prying caller that some other practitioner's specific submission id
 * exists. Ownership is folded into the lookup itself, since the guard has no
 * way to know which practitioner a submissionId belongs to beforehand.
 */
export async function requestDocumentDownloadUrl(
  input: RequestDocumentDownloadUrlParams,
): Promise<DocumentDownloadUrl> {
  const submission = await prisma.credentialSubmission.findFirst({
    where: {
      id: input.submissionId,
      deletedAt: null,
      ...(input.scopeType === 'PLATFORM' ? {} : { userId: input.scopeId }),
    },
  });
  if (!submission) throw CredentialErrors.submissionNotFound();
  if (!submission.documentObjectKey) throw CredentialErrors.noDocumentOnSubmission();

  const downloadUrl = await createDownloadUrl(submission.documentObjectKey);

  // A read, not a state change: evidence in security_events (already exempt
  // from audit coverage) rather than a coverage-checked audit_log row, same
  // reasoning recordAuditTrailAccess already uses for "who read the audit
  // trail."
  await prisma.securityEvent.create({
    data: {
      userId: input.viewerId,
      kind: 'credential.document_accessed',
      severity: 'info',
      detail: { submissionId: submission.id, scopeType: input.scopeType },
    },
  });

  return { downloadUrl, expiresInSeconds: env.STORAGE_SIGNED_URL_TTL_SECONDS };
}
