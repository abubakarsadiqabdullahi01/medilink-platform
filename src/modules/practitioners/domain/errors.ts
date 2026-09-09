import { HttpError } from '@/lib/http/errors';

/**
 * Practitioner-profile failures carry a stable code and an HTTP status,
 * matching the shape of src/modules/auth/domain/errors.ts's AuthError.
 */
export class PractitionerError extends HttpError {}

export const PractitionerErrors = {
  profileNotFound: () =>
    new PractitionerError(
      'profile_not_found',
      'You have not created a practitioner profile yet.',
      404,
    ),

  profileAlreadyExists: () =>
    new PractitionerError(
      'profile_already_exists',
      'A practitioner profile already exists for this account. Use PATCH to update it.',
      409,
    ),

  invalidCategory: () =>
    new PractitionerError('invalid_professional_category', 'Choose a valid professional category.', 422),

  invalidSpecialty: () =>
    new PractitionerError(
      'invalid_specialty',
      'That specialty is not valid for the selected category.',
      422,
    ),

  invalidState: () => new PractitionerError('invalid_state', 'Choose a valid state.', 422),

  invalidPhotoReference: () =>
    new PractitionerError(
      'invalid_photo_reference',
      'That photo has not finished uploading, or does not belong to you.',
      422,
    ),
} as const;
