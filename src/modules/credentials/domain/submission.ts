/**
 * Credential-submission policy: pure, no database.
 */
export type RequiredEvidence = 'document' | 'reference_number';

const REFERENCE_NUMBER_METHODS = new Set(['nimc_verification', 'mdcn_status_check']);

/**
 * Which evidence field a submission must supply, from the credential type's
 * verificationMethod. An unrecognised method — a future CredentialType row
 * this code doesn't know about — defaults to 'document': a human reviewer
 * can always read a document, but cannot check a reference number against a
 * verification system that does not exist yet (see the stage doc for why
 * neither NIMC nor MDCN verification is automated in this cut).
 */
export function requiredEvidenceFor(verificationMethod: string): RequiredEvidence {
  return REFERENCE_NUMBER_METHODS.has(verificationMethod) ? 'reference_number' : 'document';
}

/** Whether the credential is checked against a record by number, rather than by reading a document. */
export function isReferenceChecked(verificationMethod: string): boolean {
  return REFERENCE_NUMBER_METHODS.has(verificationMethod);
}

/**
 * A National Identification Number is the one reference that must not sit in
 * clear text in the append-only audit trail, nor stay readable once it has
 * served its purpose: the identity record keeps only a keyed digest and the
 * last four digits, and a credential row that kept the whole number would
 * quietly undo that.
 */
export function holdsNin(verificationMethod: string): boolean {
  return verificationMethod === 'nimc_verification';
}

/** "12345678901" → "*******8901". Keeps enough to recognise, not enough to use. */
export function maskReference(reference: string): string {
  const last4 = reference.slice(-4);
  return `${'*'.repeat(Math.max(reference.length - 4, 0))}${last4}`;
}

export const REFERENCE_NUMBER_MAX_LENGTH = 100;
export const REVIEW_NOTES_MAX_LENGTH = 1000;

/**
 * `reviewDays` out from `from`, or null when the credential type never
 * expires. Computed once at verification time; nothing sweeps for expiry
 * yet, so this is stored for a future consumer rather than acted on now.
 */
export function computeExpiresAt(
  credentialType: { expires: boolean; reviewDays: number },
  from: Date,
): Date | null {
  if (!credentialType.expires) return null;
  const result = new Date(from);
  result.setUTCDate(result.getUTCDate() + credentialType.reviewDays);
  return result;
}
