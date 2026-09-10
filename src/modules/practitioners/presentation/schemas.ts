import { z } from 'zod';
import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '@/lib/storage/tigris';
import { BIO_MAX_LENGTH, YEARS_OF_EXPERIENCE_MAX, YEARS_OF_EXPERIENCE_MIN } from '../domain/profile';
import { FOLIO_NUMBER_MAX_LENGTH } from '../domain/verification';

/**
 * Request validation at the boundary. Every route parses its body or query
 * through one of these, so a handler never sees an unchecked value.
 */
const professionalCategoryId = z.string().uuid();
const specialtyId = z.string().uuid();
const homeStateId = z.string().uuid();
const yearsOfExperience = z.coerce
  .number()
  .int()
  .min(YEARS_OF_EXPERIENCE_MIN)
  .max(YEARS_OF_EXPERIENCE_MAX);
const bio = z.string().trim().max(BIO_MAX_LENGTH);
const photoObjectKey = z.string().min(1).max(500);

export const getProfileSchema = z.object({});

export const createProfileSchema = z.object({
  professionalCategoryId,
  specialtyId: specialtyId.optional(),
  yearsOfExperience,
  bio: bio.optional(),
  homeStateId: homeStateId.optional(),
  photoObjectKey: photoObjectKey.optional(),
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

/**
 * Every field optional (PATCH is a partial update), and the nullable columns
 * accept `null` explicitly so a caller can distinguish "leave unchanged"
 * (omit) from "clear it" (`null`) — Prisma's own `update({ data })` already
 * treats `undefined` as "don't touch" and `null` as "set NULL".
 */
export const updateProfileSchema = z.object({
  professionalCategoryId: professionalCategoryId.optional(),
  specialtyId: specialtyId.nullable().optional(),
  yearsOfExperience: yearsOfExperience.optional(),
  bio: bio.nullable().optional(),
  homeStateId: homeStateId.nullable().optional(),
  photoObjectKey: photoObjectKey.nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const requestPhotoUploadUrlSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().refine((value) => ALLOWED_CONTENT_TYPES.has(value), 'Unsupported file type.'),
  sizeBytes: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_BYTES, 'File is too large.'),
});
export type RequestPhotoUploadUrlInput = z.infer<typeof requestPhotoUploadUrlSchema>;

/**
 * Identity and professional-registration recording (steps 5.3, 5.4, 5.5).
 *
 * The NIN is validated and normalised here so a malformed one is a 422 with a
 * usable message. It is the only place the raw number appears in a schema —
 * everything downstream works with the keyed digest and the last four digits.
 */
const nin = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^\d{11}$/.test(value), {
    message: 'A National Identification Number is 11 digits.',
  });

export const recordIdentitySchema = z.object({
  userId: z.string().uuid(),
  nin,
  /**
   * Required in practice when verification runs manually, which is the
   * default; the service rejects its absence rather than the schema, because
   * whether it is needed depends on a runtime switch, not on the request.
   */
  nameMatch: z.boolean().optional(),
});
export type RecordIdentityInput = z.infer<typeof recordIdentitySchema>;

export const recordRegistrationSchema = z.object({
  userId: z.string().uuid(),
  regulator: z.string().trim().min(2).max(20),
  folioNumber: z.string().trim().min(3).max(FOLIO_NUMBER_MAX_LENGTH),
  registrationStatus: z.enum(['ACTIVE', 'SUSPENDED', 'EXPIRED', 'STRUCK_OFF', 'UNKNOWN']).optional(),
  practiceType: z.string().trim().max(100).optional(),
  location: z.string().trim().max(200).optional(),
  expiresAt: z.coerce.date().optional(),
});
export type RecordRegistrationInput = z.infer<typeof recordRegistrationSchema>;

/** SELF for a practitioner's own record, PLATFORM for compliance. */
export const verificationQuerySchema = z.object({
  scopeType: z.enum(['SELF', 'PLATFORM']),
  scopeId: z.string().uuid().optional(),
});
export type VerificationQueryInput = z.infer<typeof verificationQuerySchema>;

/**
 * Step 5.8. Same shape as verificationQuerySchema, kept as its own schema
 * rather than shared: the two guard unrelated endpoints, and a future filter
 * added to one should not silently reach the other.
 */
export const eligibilityQuerySchema = z.object({
  scopeType: z.enum(['SELF', 'PLATFORM']),
  scopeId: z.string().uuid().optional(),
});
export type EligibilityQueryInput = z.infer<typeof eligibilityQuerySchema>;
