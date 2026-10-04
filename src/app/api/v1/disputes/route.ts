import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { disputeQueueSchema } from '@/modules/disputes/presentation/schemas';
import { listDisputes } from '@/modules/disputes/application/dispute';

/** GET /api/v1/disputes — the adjudicator's queue, oldest first, filterable and paged. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: disputeQueueSchema,
    permission: 'dispute.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) => listDisputes(input),
  });
}
