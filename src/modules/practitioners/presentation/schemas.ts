import { z } from 'zod';
import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES } from '@/lib/storage/tigris';
import { BIO_MAX_LENGTH, YEARS_OF_EXPERIENCE_MAX, YEARS_OF_EXPERIENCE_MIN } from '../domain/profile';

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
