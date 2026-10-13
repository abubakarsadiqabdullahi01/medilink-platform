/**
 * Facility rules that need no database: whether a facility may publish work,
 * and how a CAC registration number is normalised before it is stored.
 *
 * Pure by design. Stage 6 publishes service requests and will call
 * canPublish() on the way in; keeping the rule here means Stage 6 consumes a
 * decision rather than re-deriving one, and the rule is testable now, before
 * anything can publish at all.
 */

export const FACILITY_NAME_MAX_LENGTH = 200;
export const ADDRESS_MAX_LENGTH = 500;
export const REVIEW_NOTES_MAX_LENGTH = 2000;
export const CAC_NUMBER_MAX_LENGTH = 20;

export type FacilityStatusValue = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';

export type PublishBlocker = 'deleted' | 'suspended' | 'not_verified' | 'licence_expired';

export interface PublishCandidate {
  status: FacilityStatusValue;
  deletedAt: Date | null;
  licenceExpiresAt: Date | null;
}

/**
 * Every reason this facility may not publish, not just the first. A facility
 * administrator fixing one problem should not have to submit again to
 * discover the next one.
 *
 * `suspended` and `not_verified` are mutually exclusive: a suspended facility
 * was verified once, and reporting both would misdescribe why it stopped.
 */
export function publishBlockers(
  facility: PublishCandidate,
  now: Date = new Date(),
): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];

  if (facility.deletedAt) blockers.push('deleted');

  if (facility.status === 'SUSPENDED') {
    blockers.push('suspended');
  } else if (facility.status !== 'VERIFIED') {
    blockers.push('not_verified');
  }

  // A lapsed licence blocks publishing the moment it lapses, with no
  // scheduled job involved. Step 5.9's automatic *suspension* still needs
  // one; this is the half that does not.
  if (facility.licenceExpiresAt && facility.licenceExpiresAt.getTime() <= now.getTime()) {
    blockers.push('licence_expired');
  }

  return blockers;
}

/** Rule 5 of the README, for facilities: unverified work never reaches anyone. */
export function canPublish(facility: PublishCandidate, now: Date = new Date()): boolean {
  return publishBlockers(facility, now).length === 0;
}

/**
 * Uppercased and stripped of whitespace and the punctuation people put inside
 * a registration number before storage, so the unique constraint means what it
 * says: `rc 123456`, `RC-123456`, `RC/123456` and `RC123456` are the same
 * registration and the second one must be refused.
 *
 * Leading zeros are left alone. `BN0099887` is a real number, and stripping a
 * zero would be a guess about what the register means.
 */
export function normaliseCacNumber(raw: string): string {
  return raw.replace(/[\s\-/.]+/g, '').toUpperCase();
}

/**
 * What a facility is registered under (FAC-05, UXF-02).
 *
 * A CAC number was mandatory, and government hospitals and primary health centres
 * - most of the facilities in Gombe - have none: they could not register
 * truthfully. Another kind of reference is no weaker a claim; it is checked by
 * the same person against the same licence document, with the same evidence
 * recorded before approval.
 */
export const REGISTRATION_KINDS = ['CAC', 'GOVERNMENT', 'OTHER'] as const;
export type RegistrationKind = (typeof REGISTRATION_KINDS)[number];

export const REGISTRATION_REFERENCE_MAX_LENGTH = 60;

/**
 * A CAC number has a shape and one spelling. A government reference is whatever
 * the ministry or the state hospitals board issued - a code, a letter reference -
 * and its punctuation is part of it, so only its case and spacing are settled.
 */
export function normaliseRegistrationReference(kind: RegistrationKind, raw: string): string {
  return kind === 'CAC' ? normaliseCacNumber(raw) : raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Why a (normalised) reference cannot be accepted, or null. */
export function registrationReferenceProblem(kind: RegistrationKind, normalised: string): string | null {
  if (kind === 'CAC') {
    return /^[A-Z0-9]{4,20}$/.test(normalised)
      ? null
      : 'Enter a CAC registration number, for example RC123456.';
  }
  if (normalised.length < 3) return 'Enter the registration or reference number you were given.';
  if (normalised.length > REGISTRATION_REFERENCE_MAX_LENGTH) {
    return `That reference is too long; the limit is ${REGISTRATION_REFERENCE_MAX_LENGTH} characters.`;
  }
  return null;
}

/** What an officer confirms they did, before a facility can be approved. */
export interface ApprovalChecks {
  /** The licence document was opened and is legible. */
  licenceDocumentSeen: boolean;
  /** The name and address on it are this facility's. */
  licenceMatchesFacility: boolean;
  /** The registration reference was checked with whoever issued it. */
  registrationChecked: boolean;
  /** How: who was asked, or what was looked at. */
  checkedWith: string;
}

export type ApprovalBlocker =
  | 'no_licence_document'
  | 'no_licence_number'
  | 'checks_incomplete'
  | 'checked_with_missing';

/** "Verify" was a live button whether or not a licence was on file, and recorded a free-text note. */
export const CHECKED_WITH_MIN_LENGTH = 10;

/**
 * Everything standing between a facility and approval, all at once so an officer
 * fixes the list rather than discovering it a refusal at a time (UXO-02).
 */
export function approvalBlockers(
  facility: { licenceObjectKey: string | null; licenceNumber: string | null },
  checks: ApprovalChecks | undefined,
): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = [];
  if (!facility.licenceObjectKey) blockers.push('no_licence_document');
  if (!facility.licenceNumber?.trim()) blockers.push('no_licence_number');

  if (!checks || !checks.licenceDocumentSeen || !checks.licenceMatchesFacility || !checks.registrationChecked) {
    blockers.push('checks_incomplete');
  } else if (checks.checkedWith.trim().length < CHECKED_WITH_MIN_LENGTH) {
    blockers.push('checked_with_missing');
  }
  return blockers;
}
