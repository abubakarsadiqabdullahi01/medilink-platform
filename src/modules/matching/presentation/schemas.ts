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

const facilityId = z.string().uuid();

export const inviteSchema = z.object({
  id: z.string().uuid(),
  facilityId,
  userIds: z.array(z.string().uuid()).min(1).max(50),
  matchRunId: z.string().uuid().optional(),
  expiresInHours: z.coerce.number().int().min(1).max(168).optional(),
});
export type InviteInput = z.infer<typeof inviteSchema>;

export const respondSchema = z
  .object({
    id: z.string().uuid(),
    decision: z.enum(['accept', 'decline']),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.decision === 'accept' || Boolean(value.reason?.length), {
    // A decline with no reason tells a facility nothing about whether to ask
    // again, and the pilot's suggestion log is built from exactly this.
    message: 'A reason is required when declining.',
    path: ['reason'],
  });
export type RespondInput = z.infer<typeof respondSchema>;

export const confirmSchema = z.object({
  id: z.string().uuid(),
  facilityId,
  userId: z.string().uuid(),
});
export type ConfirmInput = z.infer<typeof confirmSchema>;

export const cancelAssignmentSchema = z.object({
  id: z.string().uuid(),
  facilityId,
  reason: z.string().trim().min(3).max(500),
});
export type CancelAssignmentInput = z.infer<typeof cancelAssignmentSchema>;

export const listAssignmentsSchema = z.object({
  scopeType: z.enum(['SELF', 'FACILITY']),
  scopeId: z.string().uuid().optional(),
  status: z.enum(['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
});
export type ListAssignmentsInput = z.infer<typeof listAssignmentsSchema>;

export const invitationsQuerySchema = z.object({});
