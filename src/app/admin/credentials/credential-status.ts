/**
 * What a credential submission can be, and which of those a reviewer can act on.
 *
 * The statuses are the schema's `CredentialSubmissionStatus`, spelled once. A string literal
 * written by hand in a component is a typo waiting for a compile that does not catch it —
 * `INFO_REQUESTED` sat in one screen for months, comparing against a status that does not
 * exist, so that screen's idea of "can still be decided" was wrong in the one way nobody noticed.
 * Typed here, a misspelling does not build; and `credential-status.test.ts` fails if the schema
 * gains or loses a status this list does not know.
 */
export const CREDENTIAL_STATUSES = [
  ['PENDING', 'Pending'],
  ['MORE_INFO_REQUESTED', 'Info requested'],
  ['VERIFIED', 'Verified'],
  ['REJECTED', 'Rejected'],
  ['EXPIRED', 'Expired'],
] as const;

export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number][0];

export type CredentialDecision = 'approve' | 'reject' | 'request_info';

/**
 * Only a PENDING submission can be decided.
 *
 * The server refuses anything else ("already reviewed"). A submission the reviewer has asked
 * more of is MORE_INFO_REQUESTED and waits on the practitioner, whose reply returns it to
 * PENDING — it is not on the reviewer's list again until then, so it offers no buttons.
 */
export function canDecide(status: CredentialStatus): boolean {
  return status === 'PENDING';
}

/** Waiting on the practitioner, not on a reviewer. */
export function isAwaitingPractitioner(status: CredentialStatus): boolean {
  return status === 'MORE_INFO_REQUESTED';
}

/** A reason is what tells the practitioner what to fix, so rejecting or asking for more needs one. */
export function needsReason(decision: CredentialDecision): boolean {
  return decision !== 'approve';
}
