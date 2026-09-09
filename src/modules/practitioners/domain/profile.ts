/**
 * Practitioner profile policy: pure, no database. Identity and licence
 * verification (NIN, practising licence, documents) belong to the
 * credentials module, not here — this is only what a practitioner chooses
 * to present about themselves.
 */
export const YEARS_OF_EXPERIENCE_MIN = 0;
export const YEARS_OF_EXPERIENCE_MAX = 60;
export const BIO_MAX_LENGTH = 1000;

/**
 * A specialty belongs to exactly one professional category (config.specialties
 * has a required categoryId). Choosing no specialty is always valid — only
 * doctors have any seeded yet; choosing one from a different category is not.
 */
export function isSpecialtyValidForCategory(
  specialty: { categoryId: string } | null,
  professionalCategoryId: string,
): boolean {
  if (!specialty) return true;
  return specialty.categoryId === professionalCategoryId;
}
