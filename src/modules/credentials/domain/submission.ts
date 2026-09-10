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
