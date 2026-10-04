import { HttpError } from '@/lib/http/errors';

/**
 * Facility failures carry a stable code and an HTTP status, matching the
 * shape of CredentialError / PractitionerError / AuthError.
 */
export class FacilityError extends HttpError {}

export const FacilityErrors = {
  facilityNotFound: () =>
    new FacilityError('facility_not_found', 'That facility does not exist.', 404),

  facilityTypeNotFound: () =>
    new FacilityError('facility_type_not_found', 'Choose a valid facility type.', 422),

  stateNotFound: () => new FacilityError('state_not_found', 'Choose a valid state.', 422),

  /** The LGA must belong to the state given, or the address is nonsense. */
  lgaNotInState: () =>
    new FacilityError('lga_not_in_state', 'That local government area is not in that state.', 422),

  representativeNotFound: () =>
    new FacilityError(
      'representative_not_found',
      'The named representative must be a registered user.',
      422,
    ),

  duplicateCacNumber: () =>
    new FacilityError(
      'duplicate_cac_number',
      'A facility with that CAC registration number already exists.',
      409,
    ),

  alreadyVerified: () =>
    new FacilityError('already_verified', 'That facility has already been reviewed.', 409),

  /**
   * The facilities equivalent of cannotReviewOwnSubmission: nothing else
   * stops a user holding both facility_owner and administrator from
   * verifying the facility they represent.
   */
  cannotVerifyOwnFacility: () =>
    new FacilityError(
      'cannot_verify_own_facility',
      'You cannot verify a facility you represent.',
      403,
    ),

  noLicenceOnFacility: () =>
    new FacilityError('no_licence_on_facility', 'This facility has no licence document.', 422),

  invalidLicenceReference: () =>
    new FacilityError(
      'invalid_licence_reference',
      'That document has not finished uploading, or was not uploaded for this facility.',
      422,
    ),
} as const;
