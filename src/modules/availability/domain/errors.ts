import { HttpError } from '@/lib/http/errors';

/**
 * Availability failures carry a stable code and an HTTP status, matching the
 * shape of PractitionerError and CredentialError.
 */
export class AvailabilityError extends HttpError {}

export const AvailabilityErrors = {
  slotNotFound: () =>
    new AvailabilityError('slot_not_found', 'That availability slot does not exist.', 404),

  blockNotFound: () =>
    new AvailabilityError('block_not_found', 'That blocked period does not exist.', 404),

  /**
   * The two slot shapes need different fields, and a row carrying the wrong
   * set is one the matcher would silently skip rather than fail on.
   */
  recurringFieldsRequired: () =>
    new AvailabilityError(
      'recurring_fields_required',
      'A recurring slot needs a day of the week and a start and end time.',
      422,
    ),

  oneOffFieldsRequired: () =>
    new AvailabilityError(
      'one_off_fields_required',
      'A one-off slot needs a start and an end.',
      422,
    ),

  endBeforeStart: () =>
    new AvailabilityError('end_before_start', 'The end must be after the start.', 422),

  /** A slot of zero length offers nothing; it is almost always a typo. */
  emptySlot: () =>
    new AvailabilityError('empty_slot', 'A slot must cover some time.', 422),
} as const;
