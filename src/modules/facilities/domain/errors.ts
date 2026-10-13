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
      'A facility with that registration number already exists.',
      409,
    ),

  invalidRegistrationReference: (problem: string) =>
    new FacilityError('invalid_registration_reference', problem, 422),

  /** Everything missing, in words, so it is fixed once rather than discovered a refusal at a time. */
  approvalBlocked: (reasons: string[]) =>
    new FacilityError(
      'approval_blocked',
      `This facility cannot be approved yet: ${reasons.join('; ')}.`,
      422,
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

  notRejected: () =>
    new FacilityError(
      'not_rejected',
      'Only a facility that was refused can be sent back for review.',
      409,
    ),

  nothingChanged: () =>
    new FacilityError(
      'nothing_changed',
      'Correct what compliance asked about first. A facility that has not changed would only be refused again for the same reason.',
      409,
    ),

  cacLocked: () =>
    new FacilityError(
      'cac_locked',
      'The registration number can only be corrected after a facility has been refused. Contact Medilink to change it.',
      409,
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
