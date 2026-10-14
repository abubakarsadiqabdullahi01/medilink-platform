import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { payoutReasonSchema } from '@/modules/billing-settlement/presentation/schemas';
import { failPayout } from '@/modules/billing-settlement/application/payout';

/**
 * POST /api/v1/payouts/:id/fail — a released payout that did not reach the
 * practitioner. Frees the balance so it can be prepared again; the ledger was never
 * written for it, so it is not touched.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: payoutReasonSchema,
      permission: 'payout.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        failPayout({ payoutId: input.id, actorId: session.userId, reason: input.reason }),
    },
    params,
  );
}
