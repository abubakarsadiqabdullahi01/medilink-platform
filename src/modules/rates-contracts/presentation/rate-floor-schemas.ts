import { z } from 'zod';

/**
 * Setting a pay floor. The amount, the date and whether the profession and
 * specialty exist are the application's to judge, so it can say why; the shape
 * alone is checked here.
 */
export const setRateFloorSchema = z.object({
  categoryKey: z.string().trim().min(1).max(80),
  /** `*` (or left out) means every specialty in the profession. */
  specialtyKey: z.string().trim().min(1).max(80).optional(),
  /** `*` (or left out) means every level. Otherwise a level of the profession. */
  cadreLevelKey: z.string().trim().min(1).max(160).optional(),
  shiftType: z.enum(['day', 'night']),
  minHourlyKobo: z.coerce.number().int(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Write the date as year-month-day.'),
});
export type SetRateFloorInput = z.infer<typeof setRateFloorSchema>;

export const listRateFloorsSchema = z.object({});
