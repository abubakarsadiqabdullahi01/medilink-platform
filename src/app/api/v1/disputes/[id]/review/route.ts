import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { disputeIdSchema } from '@/modules/disputes/presentation/schemas';
import { beginReview } from '@/modules/disputes/application/dispute';

/**
 * POST /api/v1/disputes/:id/review — an officer picks the case up.
 *
 * A claim rather than a lock: two officers opening the same case is wasted
 * effort, not a correctness problem, and resolution is compare-and-set.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: disputeIdSchema,
      permission: 'dispute.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        beginReview({ disputeId: input.id, actorId: session.userId }),
    },
    params,
  );
}
