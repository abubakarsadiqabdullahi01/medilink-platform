import { z } from 'zod';

/** A real calendar date in the past or today, written YYYY-MM-DD. */
const listedAt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Write the date as YYYY-MM-DD.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'That date is not on the calendar.')
  .refine((value) => new Date(`${value}T00:00:00.000Z`).getTime() <= Date.now() + 24 * 60 * 60 * 1000, {
    message: 'A listing cannot be dated in the future.',
  });

export const sourceListSchema = z.enum(['MDCN_QUACK_LIST', 'MDCN_SANCTIONS', 'INTERNAL']);

const entry = z.object({
  fullName: z.string().trim().min(3).max(200),
  sourceList: sourceListSchema,
  folioNumber: z.string().trim().max(60).optional(),
  reason: z.string().trim().min(3).max(500),
  listedAt,
});

/** At most five hundred at a time: a whole notice, and still read by a person before it goes in. */
export const addSanctionedEntriesSchema = z.object({
  entries: z.array(entry).min(1).max(500),
});

export const listSanctionedEntriesSchema = z.object({
  search: z.string().trim().max(120).optional(),
  sourceList: sourceListSchema.optional(),
});

export const removeSanctionedEntrySchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(5).max(500),
});
