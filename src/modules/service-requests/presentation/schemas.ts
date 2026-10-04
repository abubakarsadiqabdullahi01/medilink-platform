import { z } from 'zod';
import {
  CANCELLATION_TERMS_MAX_LENGTH,
  MAX_HEADCOUNT,
  NOTES_MAX_LENGTH,
} from '../domain/request';

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

export const createServiceRequestSchema = z.object({
  facilityId,
  professionalCategoryId: z.string().uuid(),
  specialtyId: z.string().uuid().optional(),
  shiftType: z.enum(['DAY', 'NIGHT']),
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
});
export type CreateServiceRequestInput = z.infer<typeof createServiceRequestSchema>;

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
