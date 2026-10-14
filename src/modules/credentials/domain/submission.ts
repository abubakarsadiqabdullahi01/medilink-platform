import { endOfLagosDay, isDateOnly, lagosDate } from '@/lib/lagos-date';

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
 * expires. The fallback for a document whose printed date nobody read: see
 * `expiryFor`, which is what verification uses.
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

/** A printed expiry further ahead than this is nearly always a mistyped year. */
export const PRINTED_EXPIRY_MAX_YEARS = 15;

export type PrintedExpiryProblem = 'format' | 'past' | 'too_far' | 'not_applicable';

/**
 * What is wrong with an expiry date the reviewer read off the document, or null
 * if nothing is.
 *
 * A date that has already passed is refused because a document that has expired
 * is not one to verify: the reviewer should reject it or ask for the renewal.
 * Today is allowed, because a licence is valid through the date printed on it.
 */
export function printedExpiryProblem(
  credentialType: { expires: boolean },
  printed: string | undefined,
  now: Date,
): PrintedExpiryProblem | null {
  if (printed === undefined) return null;
  if (!isDateOnly(printed)) return 'format';
  if (!credentialType.expires) return 'not_applicable';

  const today = lagosDate(now);
  if (printed < today) return 'past';

  const limit = new Date(now);
  limit.setUTCFullYear(limit.getUTCFullYear() + PRINTED_EXPIRY_MAX_YEARS);
  if (printed > lagosDate(limit)) return 'too_far';

  return null;
}

/**
 * When a credential expires, and whether the date came from the document.
 *
 * The date printed on the document governs. It used to be the review date plus
 * the type's review days, which put a date in front of the practitioner that
 * appears nowhere on what they uploaded (CRE-04). The printed date is valid
 * through that day, so the instant is the end of it in Lagos.
 *
 * With no date read, the review interval is the fallback and `documentExpiresOn`
 * stays null, so every screen can say the date is an estimate. The caller has
 * already asked `printedExpiryProblem`.
 */
export function expiryFor(
  credentialType: { expires: boolean; reviewDays: number },
  now: Date,
  printed: string | undefined,
): { expiresAt: Date | null; documentExpiresOn: string | null } {
  if (!credentialType.expires) return { expiresAt: null, documentExpiresOn: null };
  if (printed === undefined) {
    return { expiresAt: computeExpiresAt(credentialType, now), documentExpiresOn: null };
  }
  return { expiresAt: endOfLagosDay(printed), documentExpiresOn: printed };
}
