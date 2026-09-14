import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { incidentIdSchema } from '@/modules/clinical-incidents/presentation/schemas';
import {
  getIncident,
  listIncidentsForSubject,
} from '@/modules/clinical-incidents/application/incident';

/**
 * GET /api/v1/incidents/:id — the case, and every other report naming the
 * same practitioner.
 *
 * The history comes back alongside because one incident read alone cannot
 * distinguish a bad night from a pattern, and that distinction is the whole
 * of the decision compliance has to make.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: incidentIdSchema,
      permission: 'incident.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input }) => {
        const incident = await getIncident(input.id);
        return {
          incident,
          subjectHistory: incident.subjectUserId
            ? await listIncidentsForSubject(incident.subjectUserId)
            : [],
        };
      },
    },
    params,
  );
}
