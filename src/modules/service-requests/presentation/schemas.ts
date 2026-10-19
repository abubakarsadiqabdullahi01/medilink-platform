import { z } from 'zod';
import {
  CANCELLATION_TERMS_MAX_LENGTH,
  MAX_HEADCOUNT,
  NOTES_MAX_LENGTH,
} from '../domain/request';
import { deriveShiftType } from '../domain/shift-type';

/**
 * Request validation at the boundary.
 *
 * `facilityId` is required on every route, including the `:id` ones, because
 * it is what the authorisation scope is checked against — the guard runs
 * before any database read, so the caller has to name the facility they claim
 * to be acting for. Naming one they hold permission for, with an id belonging
 * to another, yields a 404 from the lookup rather than a way in.
 */
const facilityId = z.string().uuid();
const requestStatus = z.enum(['DRAFT', 'PUBLISHED', 'FILLED', 'CANCELLED', 'EXPIRED']);

export const createServiceRequestSchema = z
  .object({
  facilityId,
  professionalCategoryId: z.string().uuid(),
  specialtyId: z.string().uuid().optional(),
  // Required once the profession has levels in use; the application says which and why (REQ-01).
  cadreLevelId: z.string().uuid().optional(),
  // Whether somebody is there to supervise, which a practitioner on a provisional register needs.
  supervisionAvailable: z.boolean().optional(),
  // Optional: worked out from the times when it is left out.
  shiftType: z.enum(['DAY', 'NIGHT']).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  headcount: z.coerce.number().int().min(1).max(MAX_HEADCOUNT).default(1),
  // Integer kobo, never a float — rule 3. `.int()` is what enforces it here.
  hourlyRateKobo: z.coerce.number().int().positive(),
  urgency: z.enum(['ROUTINE', 'URGENT', 'EMERGENCY']).default('ROUTINE'),
  // Required: what happens if either side pulls out is the term disputes turn
  // on, and a request without it is one nobody can adjudicate later.
  cancellationTerms: z.string().trim().min(10).max(CANCELLATION_TERMS_MAX_LENGTH),
  notes: z.string().trim().max(NOTES_MAX_LENGTH).optional(),
  })
  // Day or night is a fact about the hours, and the pay floor differs by it, so a facility
  // cannot call a night shift a day shift to be held to the lower floor (UXF-06). Left out,
  // it is worked out; said, it has to agree.
  .superRefine((input, context) => {
    if (input.shiftType === undefined || input.endsAt.getTime() <= input.startsAt.getTime()) return;
    const derived = deriveShiftType(input.startsAt, input.endsAt);
    if (input.shiftType !== derived) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shiftType'],
        message: `These hours make it a ${derived.toLowerCase()} shift (night is 20:00 to 06:00), so it is held to the ${derived.toLowerCase()} floor. Leave the type out and it is worked out for you.`,
      });
    }
  });
export type CreateServiceRequestInput = Omit<z.infer<typeof createServiceRequestSchema>, 'shiftType'> & {
  shiftType: 'DAY' | 'NIGHT';
};

/** `id` is merged in from the route's [id] segment; facilityId carries the scope. */
export const requestActionSchema = z.object({
  id: z.string().uuid(),
  facilityId,
});
export type RequestActionInput = z.infer<typeof requestActionSchema>;

export const cancelRequestSchema = requestActionSchema.extend({
  reason: z.string().trim().min(3).max(500),
});
export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;

export const listServiceRequestsSchema = z.object({
  scopeType: z.enum(['FACILITY', 'PLATFORM']),
  scopeId: facilityId.optional(),
  status: requestStatus.optional(),
  professionalCategoryId: z.string().uuid().optional(),
  /** Matches free text against a shift's notes — the only text a scheduler
   * actually writes on one (ward, contact, what to bring). */
  search: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});
export type ListServiceRequestsInput = z.infer<typeof listServiceRequestsSchema>;

/**
 * What a shift will come to, before it is published (M11-04). A read: nothing is created, which is
 * why the times and the rate come in the query rather than a body.
 */
export const estimateShiftSchema = z.object({
  facilityId,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  hourlyRateKobo: z.coerce.number().int().min(1).max(100_000_000),
  headcount: z.coerce.number().int().min(1).max(MAX_HEADCOUNT).default(1),
});
