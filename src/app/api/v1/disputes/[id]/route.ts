import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { disputeIdSchema } from '@/modules/disputes/presentation/schemas';
import { getDispute } from '@/modules/disputes/application/dispute';
import { listEvidence } from '@/modules/disputes/application/evidence';

/**
 * GET /api/v1/disputes/:id — the case and what has been attached to it.
 *
 * The evidence list comes back alongside because a case read without it is
 * one nobody can adjudicate.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: disputeIdSchema,
      permission: 'dispute.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input }) => ({
        dispute: await getDispute(input.id),
        evidence: await listEvidence(input.id),
      }),
    },
    params,
  );
}
