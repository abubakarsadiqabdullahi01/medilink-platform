import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { incidentIdSchema } from '@/modules/clinical-incidents/presentation/schemas';
import {
  currentSuspension,
  suspensionHistory,
} from '@/modules/clinical-incidents/application/suspension';

/**
 * GET /api/v1/users/:id/suspensions — how this account got where it is.
 *
 * `identity.users.status` says what somebody is now; this says why, and what
 * happened before. Lifted suspensions are included, because a history that
 * only showed the current one would hide the pattern that matters most.
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
      action: async ({ input }) => ({
        current: await currentSuspension(input.id),
        history: await suspensionHistory(input.id),
      }),
    },
    params,
  );
}
