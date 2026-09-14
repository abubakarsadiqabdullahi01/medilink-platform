import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { disputeIdSchema } from '@/modules/disputes/presentation/schemas';
import { withdrawDispute } from '@/modules/disputes/application/dispute';

/**
 * POST /api/v1/disputes/:id/withdraw — the party who raised it takes it back.
 *
 * The row stays, with its reason and its withdrawal time. A case that
 * vanished when somebody thought better of it would take the other party's
 * side of the story with it.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: disputeIdSchema,
      permission: 'dispute.manage',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) =>
        withdrawDispute({ disputeId: input.id, actorId: session.userId }),
    },
    params,
  );
}
