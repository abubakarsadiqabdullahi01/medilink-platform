import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { closeIncidentSchema } from '@/modules/clinical-incidents/presentation/schemas';
import { closeIncident } from '@/modules/clinical-incidents/application/incident';

/**
 * POST /api/v1/incidents/:id/close — an outcome and a reason.
 *
 * `PRACTITIONER_SUSPENDED` suspends in the same transaction as the closure,
 * so the two cannot disagree. `SYSTEM_ISSUE` is in the list and near the top
 * of it on purpose: it is the commonest true answer to a clinical incident,
 * and the one a blame-first process never reaches.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: closeIncidentSchema,
      permission: 'incident.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        closeIncident({
          incidentId: input.id,
          actorId: session.userId,
          outcome: input.outcome,
          notes: input.notes,
        }),
    },
    params,
  );
}
