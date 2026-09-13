import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  listIncidentsSchema,
  reportIncidentSchema,
} from '@/modules/clinical-incidents/presentation/schemas';
import {
  listIncidentsForFacility,
  reportIncident,
} from '@/modules/clinical-incidents/application/incident';

/**
 * POST /api/v1/incidents — a facility reports what happened on its floor.
 *
 * The easiest thing in the module to do, deliberately: a summary, a time and
 * a severity. Every extra mandatory field is a reason somebody closes the
 * form instead, and the report never happens.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: reportIncidentSchema,
    permission: 'incident.report',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ input, session }) =>
      reportIncident({
        facilityId: input.facilityId,
        actorId: session.userId,
        assignmentId: input.assignmentId,
        subjectUserId: input.subjectUserId,
        occurredAt: input.occurredAt,
        severity: input.severity,
        category: input.category,
        summary: input.summary,
      }),
  });
}

/** GET — the facility's own reports, newest first. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listIncidentsSchema,
    permission: 'incident.report',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ input }) => ({
      incidents: await listIncidentsForFacility(input.facilityId),
    }),
  });
}
