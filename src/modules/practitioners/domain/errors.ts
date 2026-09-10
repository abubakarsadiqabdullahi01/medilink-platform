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

  practitionerNotFound: () =>
    new PractitionerError('practitioner_not_found', 'That practitioner does not exist.', 404),

  /**
   * There is no sensible default for "did the name on the slip match?".
   * Assuming true would let a mismatched identity through silently, which is
   * the failure identity verification exists to catch.
   */
  nameMatchRequired: () =>
    new PractitionerError(
      'name_match_required',
      'Say whether the name on the identity slip matches the account.',
      422,
    ),

  registrationStatusRequired: () =>
    new PractitionerError(
      'registration_status_required',
      'Record what the register showed for this folio number.',
      422,
    ),

  duplicateNin: () =>
    new PractitionerError(
      'duplicate_nin',
      'That identity is already registered to another account.',
      409,
    ),

  duplicateFolioNumber: () =>
    new PractitionerError(
      'duplicate_folio_number',
      'That folio number is already registered to another account.',
      409,
    ),
} as const;
