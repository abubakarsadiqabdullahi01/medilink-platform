import { z } from 'zod';
import { AUDIT_AREA_VALUES } from '../domain/audit-areas';

/**
 * The audit trail is queried within a scope, never globally by default.
 *
 * A missing scope could reasonably mean "everything I am allowed to see",
 * and that reading is how a facility administrator ends up with a page of
 * another facility's records because one branch of the query builder forgot
 * a filter. Requiring the caller to name the scope means the authorisation
 * check and the database filter are derived from the same value.
 */
export const auditQuerySchema = z
  .object({
    scopeType: z.enum(['PLATFORM', 'FACILITY_GROUP', 'FACILITY', 'BRANCH', 'DEPARTMENT', 'SELF']),
    scopeId: z.string().uuid().optional(),

    entityType: z.string().min(1).max(100).optional(),
    entityId: z.string().uuid().optional(),
    actorId: z.string().uuid().optional(),
    action: z.string().min(1).max(100).optional(),

    // A group of subjects rather than one exact action: see domain/audit-areas.
    // `action` stays an exact match for the callers that know what they want.
    area: z.enum(AUDIT_AREA_VALUES).optional(),

    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),

    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().uuid().optional(),
  })
  .refine(
    (query) => query.scopeType === 'PLATFORM' || query.scopeType === 'SELF' || Boolean(query.scopeId),
    {
      // PLATFORM has no id, and SELF's is the session's. Every other scope
      // names the facility, branch or department it means.
      message: 'scopeId is required for this scope type.',
      path: ['scopeId'],
    },
  );

export type AuditQuery = z.infer<typeof auditQuerySchema>;
