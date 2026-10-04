import { z } from 'zod';
import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '@/lib/storage/tigris';
import { REFERENCE_NUMBER_MAX_LENGTH, REVIEW_NOTES_MAX_LENGTH } from '../domain/submission';

/**
 * Request validation at the boundary. Which of referenceNumber/document is
 * actually required depends on the credential type's verificationMethod — a
 * database read — so that check lives in the application layer
 * (requiredEvidenceFor), not here. This schema only enforces that at least
 * one shape is present.
 */
const credentialTypeId = z.string().uuid();
const referenceNumber = z.string().trim().min(1).max(REFERENCE_NUMBER_MAX_LENGTH);
const documentObjectKey = z.string().min(1).max(500);
const reviewNotes = z.string().trim().max(REVIEW_NOTES_MAX_LENGTH);
const submissionStatus = z.enum(['PENDING', 'MORE_INFO_REQUESTED', 'VERIFIED', 'REJECTED', 'EXPIRED']);

export const submitCredentialSchema = z
  .object({
    credentialTypeId,
    referenceNumber: referenceNumber.optional(),
    documentObjectKey: documentObjectKey.optional(),
  })
  .refine((value) => Boolean(value.referenceNumber) || Boolean(value.documentObjectKey), {
    message: 'Provide a reference number or a document.',
    path: ['referenceNumber'],
  });
export type SubmitCredentialInput = z.infer<typeof submitCredentialSchema>;

export const requestDocumentUploadUrlSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().refine((value) => ALLOWED_CONTENT_TYPES.has(value), 'Unsupported file type.'),
  sizeBytes: z.coerce.number().int().positive().max(MAX_UPLOAD_BYTES, 'File is too large.'),
});
export type RequestDocumentUploadUrlInput = z.infer<typeof requestDocumentUploadUrlSchema>;

/**
 * SELF or PLATFORM only — no FACILITY/BRANCH/etc., because practitioners
 * are not tied to a facility. Deliberately mirrors auditQuerySchema's shape:
 * the caller states the scope it is asking for, and the same value drives
 * both the authorisation check and the database filter.
 */
export const listSubmissionsSchema = z.object({
  scopeType: z.enum(['SELF', 'PLATFORM']),
  scopeId: z.string().uuid().optional(),
  status: submissionStatus.optional(),
  credentialTypeId: credentialTypeId.optional(),
  /** Matches the practitioner's name or phone number. PLATFORM only, in practice. */
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});
export type ListSubmissionsInput = z.infer<typeof listSubmissionsSchema>;

/** `id` is merged in from the route's [id] segment, not the request body. */
export const documentUrlSchema = z.object({
  id: z.string().uuid(),
  scopeType: z.enum(['SELF', 'PLATFORM']),
  scopeId: z.string().uuid().optional(),
});
export type DocumentUrlInput = z.infer<typeof documentUrlSchema>;

/** The practitioner's answer to a request for more information. */
export const resupplyCredentialSchema = z
  .object({
    id: z.string().uuid(),
    referenceNumber: referenceNumber.optional(),
    documentObjectKey: documentObjectKey.optional(),
  })
  .refine((value) => Boolean(value.referenceNumber) || Boolean(value.documentObjectKey), {
    message: 'Provide a reference number or a document.',
    path: ['referenceNumber'],
  });
export type ResupplyCredentialInput = z.infer<typeof resupplyCredentialSchema>;

export const reviewCredentialSchema = z
  .object({
    id: z.string().uuid(),
    decision: z.enum(['approve', 'reject', 'request_info']),
    reviewNotes: reviewNotes.optional(),
  })
  .refine((value) => value.decision === 'approve' || Boolean(value.reviewNotes?.length), {
    // A rejection without a reason cannot be acted on, and a request for more
    // information without saying what is missing is worse than no request.
    message: 'reviewNotes is required when rejecting or requesting more information.',
    path: ['reviewNotes'],
  });
export type ReviewCredentialInput = z.infer<typeof reviewCredentialSchema>;
