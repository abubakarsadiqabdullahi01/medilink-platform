import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { emptyQuerySchema } from '@/modules/clinical-incidents/presentation/schemas';
import { listOpenIncidents } from '@/modules/clinical-incidents/application/incident';

/**
 * GET /api/v1/incidents/queue — compliance's queue.
 *
 * Most serious first, oldest within that: a death reported this morning
 * outranks a near miss from March.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: emptyQuerySchema,
    permission: 'incident.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => ({ incidents: await listOpenIncidents() }),
  });
}
