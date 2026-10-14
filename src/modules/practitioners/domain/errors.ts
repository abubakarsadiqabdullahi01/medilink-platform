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
    new PractitionerError(
      'invalid_professional_category',
      'Choose a valid professional category.',
      422,
    ),

  invalidSpecialty: () =>
    new PractitionerError(
      'invalid_specialty',
      'That specialty is not valid for the selected category.',
      422,
    ),

  invalidState: () => new PractitionerError('invalid_state', 'Choose a valid state.', 422),

  invalidHomeLga: () =>
    new PractitionerError(
      'invalid_home_lga',
      'That local government area is not in the selected home state.',
      422,
    ),

  invalidPhotoReference: () =>
    new PractitionerError(
      'invalid_photo_reference',
      'That photo has not finished uploading, or does not belong to you.',
      422,
    ),

  /**
   * 422 rather than 409: nothing conflicts, the request is simply early. The
   * message says what is left because this is also what an API client sees.
   */
  applicationIncomplete: (missing: string) =>
    new PractitionerError(
      'application_incomplete',
      `Finish ${missing} before you submit for approval.`,
      422,
    ),

  noPhotoOnProfile: () =>
    new PractitionerError('no_photo_on_profile', 'There is no photograph on this profile.', 404),

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

  levelWrongProfession: () =>
    new PractitionerError(
      'level_wrong_profession',
      'That is not a level in use for this practitioner\'s profession. Pick one from the list for their profession.',
      422,
    ),

  registrationCategoryInvalid: () =>
    new PractitionerError(
      'registration_category_invalid',
      'That is not a registration category in use.',
      422,
    ),

  registrationRequired: () =>
    new PractitionerError(
      'registration_required',
      'Record their registration first, so the level has a licence checked against the register to rest on.',
      409,
    ),

  registrationStatusRequired: () =>
    new PractitionerError(
      'registration_status_required',
      'Record what the register showed for this folio number.',
      422,
    ),

  /**
   * 422: the request is well formed and the submission exists, but it is not
   * something that can be confirmed as it stands. The message says what to do.
   */
  submissionNotConfirmable: (message: string) =>
    new PractitionerError('submission_not_confirmable', message, 422),

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

  screeningNotFound: () =>
    new PractitionerError(
      'screening_not_found',
      'That practitioner has not been screened yet.',
      404,
    ),

  screeningNotFlagged: () =>
    new PractitionerError(
      'screening_not_flagged',
      'That screening result is not flagged, so there is nothing to clear.',
      409,
    ),
} as const;
