/**
 * Service-request policy: pure, no database.
 */

export type ServiceRequestStatusValue =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'FILLED'
  | 'CANCELLED'
  | 'EXPIRED';

export const CANCELLATION_TERMS_MAX_LENGTH = 2000;
export const NOTES_MAX_LENGTH = 2000;
export const MAX_HEADCOUNT = 50;
/** A shift longer than this is almost certainly a typo, and a fatigue risk. */
export const MAX_SHIFT_HOURS = 24;

const HOUR = 60 * 60 * 1000;

export function shiftHours(startsAt: Date, endsAt: Date): number {
  return (endsAt.getTime() - startsAt.getTime()) / HOUR;
}

/**
 * Which statuses a request may move to from where.
 *
 * FILLED is reachable only from PUBLISHED, and nothing returns from
 * CANCELLED or EXPIRED — a facility that changes its mind publishes a new
 * request rather than reviving one practitioners have already been told is
 * closed.
 */
const TRANSITIONS: Record<ServiceRequestStatusValue, ServiceRequestStatusValue[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['FILLED', 'CANCELLED', 'EXPIRED'],
  // A filled request can still be cancelled: a ward closing does not care
  // that it found its nurses.
  FILLED: ['CANCELLED'],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(
  from: ServiceRequestStatusValue,
  to: ServiceRequestStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export type PublishBlocker =
  | 'not_a_draft'
  | 'facility_cannot_publish'
  | 'starts_in_the_past'
  | 'below_rate_floor';

export interface PublishCheck {
  status: ServiceRequestStatusValue;
  startsAt: Date;
  facilityCanPublish: boolean;
  rateMeetsFloor: boolean;
}

/**
 * Every reason this request may not be published, not just the first — the
 * same courtesy the eligibility rule extends to a practitioner.
 */
export function publishBlockers(check: PublishCheck, now: Date = new Date()): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];

  if (check.status !== 'DRAFT') blockers.push('not_a_draft');
  // Rule 5's counterpart for facilities: unverified work never reaches
  // anyone. This is the call Stage 5.10 built canPublish for.
  if (!check.facilityCanPublish) blockers.push('facility_cannot_publish');
  if (check.startsAt.getTime() <= now.getTime()) blockers.push('starts_in_the_past');
  if (!check.rateMeetsFloor) blockers.push('below_rate_floor');

  return blockers;
}
