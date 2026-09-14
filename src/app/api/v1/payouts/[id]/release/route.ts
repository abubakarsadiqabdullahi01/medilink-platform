import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { payoutIdSchema } from '@/modules/billing-settlement/presentation/schemas';
import { releasePayout } from '@/modules/billing-settlement/application/payout';

/**
 * POST /api/v1/payouts/:id/release — send it to the gateway.
 *
 * The ledger entry is written only once the gateway says the money went. A
 * failure leaves the payout FAILED with the reason on it and the ledger
 * untouched, because nothing moved — a ledger that recorded the attempt would
 * be one that disagrees with the bank.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: payoutIdSchema,
      permission: 'payout.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        releasePayout({ payoutId: input.id, actorId: session.userId }),
    },
    params,
  );
}
