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
 * Uppercased and stripped of internal whitespace before storage, so the
 * unique constraint means what it says: `rc 123456` and `RC123456` are the
 * same registration and the second one must be refused.
 */
export function normaliseCacNumber(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}
