import { HttpError } from '@/lib/http/errors';

export class ServiceRequestError extends HttpError {}

/**
 * Kobo to the naira a person would say. The domain stores integer kobo
 * (rule 3), but a message is read by a scheduler, and "650000 kobo" made
 * them do the division in their head.
 */
function naira(kobo: number): string {
  const whole = kobo % 100 === 0;
  return `₦${(kobo / 100).toLocaleString('en-NG', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** What each facility blocker means to the person trying to publish. */
const PUBLISH_BLOCKER_TEXT: Record<string, string> = {
  not_verified: 'Medilink has not verified it',
  suspended: 'it is suspended',
  licence_expired: 'its operating licence has expired',
  deleted: 'it has been closed',
};

export const ServiceRequestErrors = {
  requestNotFound: () =>
    new ServiceRequestError('service_request_not_found', 'That service request does not exist.', 404),

  invalidCategory: () =>
    new ServiceRequestError('invalid_professional_category', 'Choose a valid professional category.', 422),

  invalidSpecialty: () =>
    new ServiceRequestError(
      'invalid_specialty',
      'That specialty is not valid for the selected category.',
      422,
    ),

  endBeforeStart: () =>
    new ServiceRequestError('end_before_start', 'The shift must end after it starts.', 422),

  shiftTooLong: (maxHours: number) =>
    new ServiceRequestError(
      'shift_too_long',
      `A shift may not run longer than ${maxHours} hours.`,
      422,
    ),

  /**
   * Names the floor rather than just refusing. A facility that is told "too
   * low" and not "the floor is ₦6,500 an hour" has to guess, and will guess
   * low again.
   */
  belowRateFloor: (minHourlyKobo: number) =>
    new ServiceRequestError(
      'below_rate_floor',
      `The rate is below the minimum for this profession and shift type, which is ${naira(minHourlyKobo)} an hour.`,
      422,
    ),

  /**
   * The other half of the floor rule (RAT-01). Nothing is wrong with the rate: the
   * platform has no minimum for this profession and shift type, and will not
   * publish one it cannot hold to a minimum.
   */
  noRateFloor: (professionName: string, shiftType: 'DAY' | 'NIGHT') =>
    new ServiceRequestError(
      'no_rate_floor',
      `Medilink has not set a minimum hourly rate for ${professionName} ${shiftType.toLowerCase()} shifts yet, so a shift for them cannot be published. This is on Medilink's side, not yours: contact support and it will be set.`,
      422,
    ),

  facilityCannotPublish: (blockers: string[]) =>
    new ServiceRequestError(
      'facility_cannot_publish',
      `This facility cannot publish shifts yet: ${blockers
        .map((blocker) => PUBLISH_BLOCKER_TEXT[blocker] ?? blocker)
        .join('; ')}.`,
      409,
    ),

  notADraft: () =>
    new ServiceRequestError('not_a_draft', 'Only a draft request can be published.', 409),

  startsInThePast: () =>
    new ServiceRequestError('starts_in_the_past', 'That shift has already started.', 422),

  invalidTransition: (from: string, to: string) =>
    new ServiceRequestError(
      'invalid_transition',
      `A ${from} request cannot become ${to}.`,
      409,
    ),
} as const;
