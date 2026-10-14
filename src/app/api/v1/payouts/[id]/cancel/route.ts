import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { payoutReasonSchema } from '@/modules/billing-settlement/presentation/schemas';
import { cancelPayout } from '@/modules/billing-settlement/application/payout';

/**
 * POST /api/v1/payouts/:id/cancel — withdraw a payout that has been prepared and not
 * yet released. A released one is recorded as settled or failed instead.
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
        cancelPayout({ payoutId: input.id, actorId: session.userId, reason: input.reason }),
    },
    params,
  );
}
