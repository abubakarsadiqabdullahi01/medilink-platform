import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { disputeQueueSchema } from '@/modules/disputes/presentation/schemas';
import { listDisputes, listDisputesForFacility } from '@/modules/disputes/application/dispute';

/**
 * GET /api/v1/disputes — the adjudicator's queue, oldest first, filterable and
 * paged; or, with `facilityId`, the cases over that facility's own shifts for the
 * person acting for it. The facility's list is only its own: the filter is the
 * shift's facility, never a name the caller typed.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: disputeQueueSchema,
    permission: 'dispute.manage',
    scope: (input) =>
      input.facilityId ? { type: 'FACILITY', id: input.facilityId } : { type: 'PLATFORM' },
    action: async ({ input }) =>
      input.facilityId
        ? { disputes: await listDisputesForFacility(input.facilityId, input.status) }
        : listDisputes(input),
  });
}
