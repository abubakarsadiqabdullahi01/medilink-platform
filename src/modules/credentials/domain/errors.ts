import { HttpError } from '@/lib/http/errors';

/**
 * Credential-submission failures carry a stable code and an HTTP status,
 * matching the shape of PractitionerError / AuthError.
 */
export class CredentialError extends HttpError {}

const PRINTED_EXPIRY_MESSAGES = {
  format: 'Write the expiry date as year-month-day, for example 2029-03-31.',
  past: 'The expiry date on that document has already passed. An expired document cannot be verified: reject it, or ask for the renewed one.',
  too_far:
    'That expiry date is more than fifteen years away, which is nearly always a mistyped year. Check it against the document.',
  not_applicable: 'This kind of credential does not expire, so there is no expiry date to record.',
  only_when_approving: 'An expiry date is recorded when a credential is approved, and at no other time.',
} as const;

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

  printedExpiryInvalid: (problem: 'format' | 'past' | 'too_far' | 'not_applicable' | 'only_when_approving') =>
    new CredentialError('printed_expiry_invalid', PRINTED_EXPIRY_MESSAGES[problem], 422),

  alreadyReviewed: () =>
    new CredentialError('already_reviewed', 'That credential submission has already been reviewed.', 409),

  notAwaitingInformation: () =>
    new CredentialError(
      'not_awaiting_information',
      'That submission is not waiting for more information.',
      409,
    ),

  /**
   * A NIN or a licence number is checked against a record, and approving it
   * has to *record* what was found — the identity or the registration that
   * eligibility reads. A bare "verify" would mark the submission good and
   * leave the practitioner still blocked, with nothing to say why.
   */
  confirmThroughPractitioner: () =>
    new CredentialError(
      'confirm_through_practitioner',
      "This is checked against a record, so confirm it from the practitioner's page: that records the identity or registration as well as approving the submission.",
      422,
    ),

  noDocumentOnSubmission: () =>
    new CredentialError('no_document_on_submission', 'This submission has no document to retrieve.', 422),

  /**
   * Closes a gap the design surfaced rather than merely documenting it:
   * nothing else stops a user holding both the practitioner and
   * administrator role from approving their own submission.
   */
  cannotReviewOwnSubmission: () =>
    new CredentialError(
      'cannot_review_own_submission',
      'You cannot review your own credential submission.',
      403,
    ),
} as const;
