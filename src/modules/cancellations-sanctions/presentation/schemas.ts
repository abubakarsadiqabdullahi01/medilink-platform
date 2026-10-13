import { z } from 'zod';
import { FAULT_REASON_MAX_LENGTH, FAULT_REASON_MIN_LENGTH } from '../domain/fault';

const uuid = z.string().uuid();

export const recordFaultSchema = z.object({
  id: uuid,
  // No default and no optional. The gate condition is that an unhonoured
  // assignment cannot be closed without a fault value, and a schema that let
  // the field be omitted would make the application layer the only thing
  // holding the line.
  fault: z.enum(['PRACTITIONER', 'FACILITY', 'NEITHER']),
  reason: z.string().trim().min(FAULT_REASON_MIN_LENGTH).max(FAULT_REASON_MAX_LENGTH),
});
export type RecordFaultInput = z.infer<typeof recordFaultSchema>;

export const listUnhonouredSchema = z.object({
  status: z.enum(['AWAITING_DECISION', 'CLOSED']).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: uuid.optional(),
});

export const requestExcusalSchema = z.object({
  id: uuid,
  reason: z.string().trim().min(FAULT_REASON_MIN_LENGTH).max(FAULT_REASON_MAX_LENGTH),
});
export type RequestExcusalInput = z.infer<typeof requestExcusalSchema>;

export const listExcusalsSchema = z.object({
  id: uuid,
  scopeType: z.enum(['SELF', 'PLATFORM']).default('SELF'),
});

export const decideExcusalSchema = z
  .object({
    id: uuid,
    decision: z.enum(['grant', 'refuse']),
    notes: z.string().trim().max(FAULT_REASON_MAX_LENGTH).optional(),
  })
  .refine(
    (value) =>
      value.decision === 'grant' || (value.notes?.trim().length ?? 0) >= FAULT_REASON_MIN_LENGTH,
    {
      message: 'A reason is required when refusing an excusal.',
      path: ['notes'],
    },
  );
export type DecideExcusalInput = z.infer<typeof decideExcusalSchema>;
