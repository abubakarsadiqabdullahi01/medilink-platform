import { z } from 'zod';

/**
 * `id` is the assignment, from the [id] route segment. `facilityId` carries
 * the authorisation scope on the facility's own acts, checked before any
 * database read — the shape attendance and matching already use.
 */
const uuid = z.string().uuid();

export const submitTimesheetSchema = z.object({ id: uuid });
export type SubmitTimesheetInput = z.infer<typeof submitTimesheetSchema>;

export const reviewTimesheetSchema = z
  .object({
    id: uuid,
    facilityId: uuid,
    decision: z.enum(['approve', 'reject']),
    reviewNotes: z.string().trim().max(1000).optional(),
  })
  .refine((value) => value.decision === 'approve' || Boolean(value.reviewNotes?.length), {
    // Step 7.5's stated test: a rejection without a reason is refused. The
    // practitioner has to know what to correct. The application layer refuses
    // it too, so the rule holds for any caller that reaches it another way.
    message: 'A reason is required when rejecting a timesheet.',
    path: ['reviewNotes'],
  });
export type ReviewTimesheetInput = z.infer<typeof reviewTimesheetSchema>;

export const correctTimesheetSchema = z.object({
  id: uuid,
  facilityId: uuid,
  checkedInAt: z.coerce.date().optional(),
  checkedOutAt: z.coerce.date().optional(),
  breakMinutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
  onCallMinutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
  // Mandatory, and long enough to be a sentence, for the reason the manual
  // fallback's reason is.
  reason: z.string().trim().min(10).max(500),
});
export type CorrectTimesheetInput = z.infer<typeof correctTimesheetSchema>;

export const readTimesheetSchema = z.object({
  id: uuid,
  scopeType: z.enum(['SELF', 'FACILITY']),
  scopeId: uuid.optional(),
});
export type ReadTimesheetInput = z.infer<typeof readTimesheetSchema>;
