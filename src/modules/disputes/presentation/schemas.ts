import { z } from 'zod';
import { DISPUTE_REASON_MAX_LENGTH, DISPUTE_REASON_MIN_LENGTH } from '../domain/dispute';

const uuid = z.string().uuid();
const reason = z.string().trim().min(DISPUTE_REASON_MIN_LENGTH).max(DISPUTE_REASON_MAX_LENGTH);

export const raiseDisputeSchema = z.object({
  id: uuid,
  // Present when a facility raises it, absent when the practitioner does.
  // Which of the two it is decides the party, and the application layer
  // checks the id against the shift so the scope guard is not the only thing
  // standing between a facility and somebody else's case.
  facilityId: uuid.optional(),
  category: z.enum(['HOURS', 'PAY', 'NON_ATTENDANCE', 'CONDUCT', 'OTHER']),
  reason,
});
export type RaiseDisputeInput = z.infer<typeof raiseDisputeSchema>;

export const listDisputesSchema = z.object({
  id: uuid,
  scopeType: z.enum(['SELF', 'FACILITY']),
  scopeId: uuid.optional(),
});

export const disputeIdSchema = z.object({ id: uuid });

/**
 * A case action available to either party.
 *
 * Practitioners omit `facilityId` and act at SELF. A facility member includes
 * it and is authorised at that FACILITY; the application layer still checks
 * that the case actually belongs to the named facility.
 */
export const partyDisputeIdSchema = z.object({ id: uuid, facilityId: uuid.optional() });

/**
 * One piece of evidence, identified by both ids.
 *
 * The dispute id comes from the path and the evidence id with it, so a
 * request cannot name evidence belonging to a different case and have the
 * scope check pass on the one it claims.
 */
export const evidenceUrlSchema = z.object({
  id: uuid,
  evidenceId: uuid,
  facilityId: uuid.optional(),
});

export const resolveDisputeSchema = z.object({
  id: uuid,
  // No default and no optional: a resolution with no outcome tells the loser
  // nothing they can act on, and the domain refuses it too.
  outcome: z.enum(['UPHELD', 'DISMISSED']),
  notes: reason,
});
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

export const evidenceUploadUrlSchema = z.object({
  id: uuid,
  facilityId: uuid.optional(),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive(),
});
export type EvidenceUploadUrlInput = z.infer<typeof evidenceUploadUrlSchema>;

export const attachEvidenceSchema = z.object({
  id: uuid,
  facilityId: uuid.optional(),
  objectKey: z.string().trim().min(1).max(500),
  note: z.string().trim().max(500).optional(),
});
export type AttachEvidenceInput = z.infer<typeof attachEvidenceSchema>;

export const disputeQueueSchema = z.object({
  /**
   * Set when a facility reads the cases over its own shifts. Without it this is the
   * adjudicator's queue, and needs `dispute.manage` over the whole platform.
   */
  facilityId: uuid.optional(),
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'WITHDRAWN']).optional(),
  /** Matches the practitioner's name or the facility's. */
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: uuid.optional(),
});
