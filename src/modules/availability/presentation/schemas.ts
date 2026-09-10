import { z } from 'zod';

/**
 * Request validation at the boundary. Which fields a slot needs depends on
 * its `kind`, and that check lives in the application layer — a conditional
 * requirement expressed as a refine gives a message that names the wrong
 * field about as often as the right one.
 */
const MINUTES_IN_DAY = 24 * 60;

const minuteOfDay = z.coerce.number().int().min(0).max(MINUTES_IN_DAY - 1);

export const addSlotSchema = z.object({
  kind: z.enum(['RECURRING_WEEKLY', 'ONE_OFF']),
  /** 0 is Sunday, matching JavaScript's getUTCDay. */
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  startMinute: minuteOfDay.optional(),
  endMinute: minuteOfDay.optional(),
  effectiveFrom: z.coerce.date().optional(),
  effectiveUntil: z.coerce.date().optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
});
export type AddSlotInput = z.infer<typeof addSlotSchema>;

export const addBlockSchema = z.object({
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  // Required: a block with no reason is one nobody can evaluate later, and
  // "why was this practitioner unavailable" is a question disputes ask.
  reason: z.string().trim().min(3).max(500),
});
export type AddBlockInput = z.infer<typeof addBlockSchema>;

/** `id` is merged in from the route's [id] segment, not the request body. */
export const slotIdSchema = z.object({ id: z.string().uuid() });

/** SELF for a practitioner's own calendar, PLATFORM for operations. */
export const availabilityQuerySchema = z.object({
  scopeType: z.enum(['SELF', 'PLATFORM']),
  scopeId: z.string().uuid().optional(),
});
export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;
