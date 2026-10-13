import { z } from 'zod';
import { normalizeNigerianPhone } from '@/lib/phone';
import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '@/lib/storage/tigris';
import {
  ADDRESS_MAX_LENGTH,
  FACILITY_NAME_MAX_LENGTH,
  REGISTRATION_KINDS,
  REGISTRATION_REFERENCE_MAX_LENGTH,
  REVIEW_NOTES_MAX_LENGTH,
  normaliseRegistrationReference,
  registrationReferenceProblem,
  type RegistrationKind,
} from '../domain/facility';

/**
 * Request validation at the boundary. Cross-row checks that need the database
 * — the LGA belonging to the state, the representative being a real user —
 * live in the application layer, not here.
 */

const facilityId = z.string().uuid();

/**
 * What the facility is registered under (FAC-05). A CAC number for a company, a
 * ministry or state board reference for a government facility: the same field,
 * with the kind beside it.
 *
 * The reference is validated and normalised by its kind in `registrationRefinement`
 * once both are known; here it is only a bounded string.
 */
const registrationKind = z.enum(REGISTRATION_KINDS);
const cacNumber = z.string().trim().min(1).max(REGISTRATION_REFERENCE_MAX_LENGTH * 2);

/**
 * Checks the reference against its kind and writes it back normalised, so the
 * value that reaches the unique constraint is the one every caller sees echoed.
 */
function registrationRefinement<T extends { registrationKind?: RegistrationKind; cacNumber?: string }>(
  value: T,
  context: z.RefinementCtx,
): T {
  if (value.cacNumber === undefined) return value;
  const kind = value.registrationKind ?? 'CAC';
  const reference = normaliseRegistrationReference(kind, value.cacNumber);
  const problem = registrationReferenceProblem(kind, reference);
  if (problem) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['cacNumber'] });
    return z.NEVER;
  }
  return { ...value, cacNumber: reference };
}

/**
 * Transformed here so a malformed number is a 422 with a usable message.
 * PhoneFormatError is not an HttpError, so letting it escape the service
 * would surface as a 500.
 */
const contactPhone = z
  .string()
  .trim()
  .min(1)
  .transform((value, ctx) => {
    try {
      return normalizeNigerianPhone(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a Nigerian phone number, for example 0803 123 4567.',
      });
      return z.NEVER;
    }
  });

const name = z.string().trim().min(2).max(FACILITY_NAME_MAX_LENGTH);
const addressLine = z.string().trim().min(4).max(ADDRESS_MAX_LENGTH);
const contactEmail = z.string().trim().email().max(255);
const licenceNumber = z.string().trim().min(1).max(100);
const reviewNotes = z.string().trim().min(1).max(REVIEW_NOTES_MAX_LENGTH);
const facilityStatus = z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED']);

export const createFacilitySchema = z
  .object({
    name,
    facilityTypeId: z.string().uuid(),
    registrationKind: registrationKind.default('CAC'),
    cacNumber,
    stateId: z.string().uuid(),
    lgaId: z.string().uuid().optional(),
    addressLine,
    contactPhone,
    contactEmail: contactEmail.optional(),
    representativeUserId: z.string().uuid(),
    licenceNumber: licenceNumber.optional(),
    licenceExpiresAt: z.coerce.date().optional(),
  })
  .transform(registrationRefinement);
export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;

/**
 * PLATFORM for the operations and compliance view, FACILITY for a facility's
 * own record. Mirrors listSubmissionsSchema: the caller states the scope it
 * is asking for, and the same value drives both the authorisation check and
 * the database filter.
 */
/**
 * Self-registration. The same details operations would type, minus the
 * representative — that is whoever is signed in, and accepting it from the
 * body would let somebody register a hospital in another person's name.
 */
export const registerFacilitySchema = z
  .object({
    name: z.string().trim().min(3).max(200),
    facilityTypeId: z.string().uuid(),
    // Which register the reference is from: a company is a CAC, a government
    // hospital or health centre is registered with its ministry or board.
    registrationKind: registrationKind.default('CAC'),
    // Normalised exactly as the operations route does. This used to take the
    // raw string, so anybody could register another hospital's number in a
    // different spelling and slip past the duplicate check.
    cacNumber,
    stateId: z.string().uuid(),
    lgaId: z.string().uuid().optional(),
    addressLine: z.string().trim().min(5).max(300),
    contactPhone: z.string().trim().min(7).max(20),
    contactEmail: z.string().trim().email().optional(),
    licenceNumber: z.string().trim().max(80).optional(),
    licenceExpiresAt: z.coerce.date().optional(),
  })
  .transform(registrationRefinement);
export type RegisterFacilityInput = z.infer<typeof registerFacilitySchema>;

export const listFacilitiesSchema = z.object({
  scopeType: z.enum(['PLATFORM', 'FACILITY']),
  scopeId: facilityId.optional(),
  status: facilityStatus.optional(),
  stateId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: facilityId.optional(),
});
export type ListFacilitiesInput = z.infer<typeof listFacilitiesSchema>;

/** `id` is merged in from the route's [id] segment, not the request body. */
export const facilityIdSchema = z.object({ id: facilityId });
export type FacilityIdInput = z.infer<typeof facilityIdSchema>;

export const updateFacilitySchema = z
  .object({
    registrationKind: registrationKind.optional(),
    id: facilityId,
    name: name.optional(),
    addressLine: addressLine.optional(),
    lgaId: z.string().uuid().optional(),
    contactPhone: contactPhone.optional(),
    contactEmail: contactEmail.optional(),
    licenceNumber: licenceNumber.optional(),
    licenceObjectKey: z.string().min(1).max(500).optional(),
    licenceExpiresAt: z.coerce.date().optional(),
    // Only a refused facility may correct its registration number, and only
    // together with sending itself back for review: see updateFacility.
    cacNumber: cacNumber.optional(),
    resubmit: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), {
    message: 'Provide at least one field to change.',
  })
  // Checked against the kind given, or against CAC when none was. The service
  // checks it against the facility's own kind when only the number is sent.
  .transform((value, context) =>
    value.registrationKind !== undefined && value.cacNumber !== undefined
      ? registrationRefinement(value, context)
      : value,
  );
export type UpdateFacilityInput = z.infer<typeof updateFacilitySchema>;

export const licenceUploadUrlSchema = z.object({
  id: facilityId,
  filename: z.string().trim().min(1).max(255),
  contentType: z
    .string()
    .refine((value) => ALLOWED_CONTENT_TYPES.has(value), 'Unsupported file type.'),
  sizeBytes: z.coerce.number().int().positive().max(MAX_UPLOAD_BYTES, 'File is too large.'),
});
export type LicenceUploadUrlInput = z.infer<typeof licenceUploadUrlSchema>;

/** What an officer confirms before a facility is approved (UXO-02). */
export const approvalChecksSchema = z.object({
  licenceDocumentSeen: z.boolean(),
  licenceMatchesFacility: z.boolean(),
  registrationChecked: z.boolean(),
  checkedWith: z.string().trim().max(500),
});

export const verifyFacilitySchema = z
  .object({
    id: facilityId,
    decision: z.enum(['approve', 'reject']),
    reviewNotes: reviewNotes.optional(),
    checks: approvalChecksSchema.optional(),
  })
  .refine((value) => value.decision === 'approve' || Boolean(value.reviewNotes?.length), {
    message: 'reviewNotes is required when rejecting a facility.',
    path: ['reviewNotes'],
  });
export type VerifyFacilityInput = z.infer<typeof verifyFacilitySchema>;
