import { z } from 'zod';

/**
 * `facilityId` carries the authorisation scope, checked before any database
 * read — the same shape service requests use, and for the same reason.
 */
export const runMatchSchema = z.object({
  id: z.string().uuid(),
  facilityId: z.string().uuid(),
});
export type RunMatchInput = z.infer<typeof runMatchSchema>;

export const readMatchRunSchema = z.object({
  id: z.string().uuid(),
  facilityId: z.string().uuid(),
});
export type ReadMatchRunInput = z.infer<typeof readMatchRunSchema>;
