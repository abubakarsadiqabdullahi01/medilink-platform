import { HttpError } from '@/lib/http/errors';

export class ServiceRequestError extends HttpError {}

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
      `The rate is below the floor for this category and shift, which is ${minHourlyKobo} kobo an hour.`,
      422,
    ),

  facilityCannotPublish: (blockers: string[]) =>
    new ServiceRequestError(
      'facility_cannot_publish',
      `This facility cannot publish work: ${blockers.join(', ')}.`,
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
