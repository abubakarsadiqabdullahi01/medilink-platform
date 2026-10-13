import { isEvidenceStale, isRegistrationUsable, type RegistrationSnapshot } from './verification';
import { isScreeningClear, type ScreeningStatusValue } from './screening';

/**
 * Step 5.8, and rule 5 of the README: no practitioner is matched to work
 * before identity and licence verification pass.
 *
 * This is the invariant the whole platform rests on, so it is a pure function
 * over an explicit input — no database, no queries, nothing that could behave
 * differently on one code path than another. Stage 6's matching calls it, and
 * a property test asserts that no combination of inputs missing identity, an
 * active registration or a clear screening is ever eligible.
 */

export type EligibilityBlocker =
  | 'account_not_usable'
  | 'profile_incomplete'
  | 'identity_unverified'
  | 'identity_name_mismatch'
  | 'registration_missing'
  | 'registration_not_active'
  | 'registration_evidence_stale'
  | 'credential_missing'
  | 'credential_expired'
  | 'screening_not_clear';

export type UserStatusValue =
  'PENDING_VERIFICATION' | 'UNDER_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface EligibilityInput {
  userStatus: UserStatusValue;
  hasProfile: boolean;
  identity: { nameMatch: boolean } | null;
  screening: { status: ScreeningStatusValue } | null;
  registration: (RegistrationSnapshot & { evidenceRetrievedAt: Date | null }) | null;
  /** How old the regulator evidence may be before it must be re-checked. */
  registrationReviewDays: number;
  requiredCredentialTypeIds: string[];
  verifiedCredentialTypeIds: string[];
  expiredCredentialTypeIds: string[];
}

export const DEFAULT_REGISTRATION_REVIEW_DAYS = 365;

/**
 * Every reason this practitioner may not be matched, not just the first.
 *
 * Returning all of them is what lets a compliance officer, or the
 * practitioner themselves, see the whole outstanding list rather than fixing
 * one thing and resubmitting to discover the next.
 */
export function eligibilityBlockers(
  input: EligibilityInput,
  now: Date = new Date(),
): EligibilityBlocker[] {
  const blockers: EligibilityBlocker[] = [];

  // UNDER_REVIEW is deliberately absent: it is the state a practitioner sits
  // in *until* they become eligible, and this function is what promotes them.
  if (input.userStatus !== 'ACTIVE' && input.userStatus !== 'UNDER_REVIEW') {
    blockers.push('account_not_usable');
  }

  if (!input.hasProfile) blockers.push('profile_incomplete');

  if (!input.identity) {
    blockers.push('identity_unverified');
  } else if (!input.identity.nameMatch) {
    // The identity was checked and did not match. Recorded rather than
    // refused at the time, precisely so it could be caught here.
    blockers.push('identity_name_mismatch');
  }

  if (!input.registration) {
    blockers.push('registration_missing');
  } else {
    if (!isRegistrationUsable(input.registration, now)) blockers.push('registration_not_active');
    if (
      isEvidenceStale(input.registration.evidenceRetrievedAt, input.registrationReviewDays, now)
    ) {
      // An active licence checked two years ago is not evidence that someone
      // may work a shift tomorrow.
      blockers.push('registration_evidence_stale');
    }
  }

  const verified = new Set(input.verifiedCredentialTypeIds);
  const expired = new Set(input.expiredCredentialTypeIds);

  // An expired row is history once a newer submission of the same type has
  // been verified: renewing leaves the old row EXPIRED on the record, and
  // counting it again would block everybody who ever renewed a licence.
  if (input.requiredCredentialTypeIds.some((id) => expired.has(id) && !verified.has(id))) {
    blockers.push('credential_expired');
  }
  if (input.requiredCredentialTypeIds.some((id) => !verified.has(id))) {
    blockers.push('credential_missing');
  }

  // Only CLEAR is clear: PENDING means nobody has looked.
  if (!isScreeningClear(input.screening)) blockers.push('screening_not_clear');

  return blockers;
}

export function isEligibleForMatching(input: EligibilityInput, now: Date = new Date()): boolean {
  return eligibilityBlockers(input, now).length === 0;
}
