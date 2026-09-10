import { HttpError } from '@/lib/http/errors';

/**
 * Credential-submission failures carry a stable code and an HTTP status,
 * matching the shape of PractitionerError / AuthError.
 */
export class CredentialError extends HttpError {}

export const CredentialErrors = {
  credentialTypeNotFound: () =>
    new CredentialError('credential_type_not_found', 'Choose a valid credential type.', 422),

  referenceNumberRequired: () =>
    new CredentialError(
      'reference_number_required',
      'This credential type is verified by reference number; provide one.',
      422,
    ),

  documentRequired: () =>
    new CredentialError(
      'document_required',
      'This credential type is verified by document review; attach a document.',
      422,
    ),

  invalidDocumentReference: () =>
    new CredentialError(
      'invalid_document_reference',
      'That document has not finished uploading, or does not belong to you.',
      422,
    ),

  duplicateActiveSubmission: () =>
    new CredentialError(
      'duplicate_active_submission',
      'A pending or verified submission already exists for this credential type.',
      409,
    ),

  submissionNotFound: () =>
    new CredentialError('submission_not_found', 'That credential submission does not exist.', 404),

  alreadyReviewed: () =>
    new CredentialError('already_reviewed', 'That credential submission has already been reviewed.', 409),

  notAwaitingInformation: () =>
    new CredentialError(
      'not_awaiting_information',
      'That submission is not waiting for more information.',
      409,
    ),

  noDocumentOnSubmission: () =>
    new CredentialError('no_document_on_submission', 'This submission has no document to retrieve.', 422),

  /**
   * Closes a gap the design surfaced rather than merely documenting it:
   * nothing else stops a user holding both the practitioner and
   * compliance_officer roles from approving their own submission.
   */
  cannotReviewOwnSubmission: () =>
    new CredentialError(
      'cannot_review_own_submission',
      'You cannot review your own credential submission.',
      403,
    ),
} as const;
