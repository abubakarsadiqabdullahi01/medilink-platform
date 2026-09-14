import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { reinstateSchema } from '@/modules/clinical-incidents/presentation/schemas';
import { reinstateAccount } from '@/modules/clinical-incidents/application/suspension';

/**
 * POST /api/v1/users/:id/reinstate — lifts a suspension.
 *
 * As much a decision as the suspension was, so it carries its own mandatory
 * reason and the suspension row is closed rather than deleted. A suspension
 * nobody can account for is how people stay suspended by accident.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: reinstateSchema,
      permission: 'incident.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        reinstateAccount({ userId: input.id, actorId: session.userId, reason: input.reason }),
    },
    params,
  );
}
