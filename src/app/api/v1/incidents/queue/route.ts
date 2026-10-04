import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { incidentQueueSchema } from '@/modules/clinical-incidents/presentation/schemas';
import { listIncidents } from '@/modules/clinical-incidents/application/incident';

/**
 * GET /api/v1/incidents/queue — compliance's queue.
 *
 * Most serious first, oldest within that: a death reported this morning
 * outranks a near miss from March.
 *
 * It used to take no arguments and return every open report. Filters, search
 * and paging were added when the queue grew past one screen; `status=CLOSED`
 * is what lets an officer answer "what did we decide about that one in
 * August", which previously had no answer short of the database.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: incidentQueueSchema,
    permission: 'incident.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) => listIncidents(input),
  });
}
