import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { incidentIdSchema } from '@/modules/clinical-incidents/presentation/schemas';
import { beginIncidentReview } from '@/modules/clinical-incidents/application/incident';

/**
 * POST /api/v1/incidents/:id/review — compliance picks the case up.
 *
 * Required before a SEVERE incident or a death can be closed: closing one
 * straight from REPORTED means nobody opened it, and the status is the only
 * evidence either way.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: incidentIdSchema,
      permission: 'incident.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        beginIncidentReview({ incidentId: input.id, actorId: session.userId }),
    },
    params,
  );
}
