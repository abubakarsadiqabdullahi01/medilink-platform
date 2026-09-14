import { z } from 'zod';
import { MAX_MULTIPLIER_BP, MIN_MULTIPLIER_BP } from '../domain/pricing';

const uuid = z.string().uuid();

/**
 * Basis points, integer only. A float here would put a fraction of a kobo
 * back into a system that stores money as integers precisely to avoid them.
 */
const multiplier = z.coerce.number().int().min(MIN_MULTIPLIER_BP).max(MAX_MULTIPLIER_BP);

export const createRateCardSchema = z.object({
  facilityId: uuid,
  name: z.string().trim().min(3).max(120),
  nightMultiplierBp: multiplier.optional(),
  holidayMultiplierBp: multiplier.optional(),
  overtimeMultiplierBp: multiplier.optional(),
  onCallMultiplierBp: multiplier.optional(),
  effectiveFrom: z.coerce.date().optional(),
});
export type CreateRateCardInput = z.infer<typeof createRateCardSchema>;

export const listRateCardsSchema = z.object({ facilityId: uuid });
