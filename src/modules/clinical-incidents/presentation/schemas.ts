import { z } from 'zod';
import {
  INCIDENT_SUMMARY_MAX_LENGTH,
  INCIDENT_SUMMARY_MIN_LENGTH,
  SUSPENSION_REASON_MIN_LENGTH,
} from '../domain/incident';

const uuid = z.string().uuid();
const summary = z.string().trim().min(INCIDENT_SUMMARY_MIN_LENGTH).max(INCIDENT_SUMMARY_MAX_LENGTH);

export const reportIncidentSchema = z.object({
  facilityId: uuid,
  // Both optional, on purpose: an incident traceable to no single shift and
  // naming no single person is still worth having.
  assignmentId: uuid.optional(),
  subjectUserId: uuid.optional(),
  occurredAt: z.coerce.date(),
  severity: z.enum(['NEAR_MISS', 'MINOR', 'MODERATE', 'SEVERE', 'DEATH']),
  category: z.enum([
    'MEDICATION',
    'CLINICAL_PROCEDURE',
    'DOCUMENTATION',
    'INFECTION_CONTROL',
    'EQUIPMENT',
    'STAFFING',
    'CONDUCT',
    'OTHER',
  ]),
  summary,
});
export type ReportIncidentInput = z.infer<typeof reportIncidentSchema>;

export const incidentIdSchema = z.object({ id: uuid });

export const closeIncidentSchema = z.object({
  id: uuid,
  outcome: z.enum([
    'SYSTEM_ISSUE',
    'NO_ACTION',
    'ADVICE_GIVEN',
    'TRAINING_REQUIRED',
    'PRACTITIONER_SUSPENDED',
    'REFERRED_TO_REGULATOR',
  ]),
  notes: summary,
});
export type CloseIncidentInput = z.infer<typeof closeIncidentSchema>;

export const reinstateSchema = z.object({
  id: uuid,
  reason: z.string().trim().min(SUSPENSION_REASON_MIN_LENGTH).max(INCIDENT_SUMMARY_MAX_LENGTH),
});
export type ReinstateInput = z.infer<typeof reinstateSchema>;

export const emptyQuerySchema = z.object({});

/**
 * The compliance queue's filters. Every one optional, and an unstated status
 * means no status filter rather than "open" — which is what lets a facility
 * read its whole incident history through the same endpoint. A caller that
 * wants only the open ones has to say so; this comment used to claim the
 * opposite, and the admin dashboard believed it.
 */
export const incidentQueueSchema = z.object({
  status: z.enum(['OPEN', 'REPORTED', 'UNDER_REVIEW', 'CLOSED']).optional(),
  severity: z.enum(['NEAR_MISS', 'MINOR', 'MODERATE', 'SEVERE', 'DEATH']).optional(),
  category: z
    .enum([
      'MEDICATION',
      'CLINICAL_PROCEDURE',
      'DOCUMENTATION',
      'INFECTION_CONTROL',
      'EQUIPMENT',
      'STAFFING',
      'CONDUCT',
      'OTHER',
    ])
    .optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: uuid.optional(),
});
export type IncidentQueueInput = z.infer<typeof incidentQueueSchema>;

/** A facility's own reports — the queue's filters, narrowed to one facility. */
export const listIncidentsSchema = incidentQueueSchema.extend({ facilityId: uuid });
export type ListIncidentsInput = z.infer<typeof listIncidentsSchema>;
