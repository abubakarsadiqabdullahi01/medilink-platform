import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { respondDisputeSchema } from '@/modules/disputes/presentation/schemas';
import { respondToDispute } from '@/modules/disputes/application/dispute';

/**
 * POST /api/v1/disputes/:id/respond — the other side answers the case, in words, once.
 *
 * The side that raised it cannot, and nor can an officer, who weighs a case and does not argue
 * it. A reply that comes after the date asked for is read like any other: the date marks the case
 * and closes nothing. The one who raised it is told there is a reply, never what it says.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: respondDisputeSchema,
      permission: 'dispute.manage',
      scope: (input, session) =>
        input.facilityId
          ? { type: 'FACILITY', id: input.facilityId }
          : { type: 'SELF', id: session.userId },
      action: async ({ input, session }) =>
        respondToDispute({ disputeId: input.id, actorId: session.userId, text: input.response }),
    },
    params,
  );
}
