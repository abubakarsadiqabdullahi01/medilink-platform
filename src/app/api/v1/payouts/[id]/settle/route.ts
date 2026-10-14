import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { settlePayoutSchema } from '@/modules/billing-settlement/presentation/schemas';
import { settlePayout } from '@/modules/billing-settlement/application/payout';

/**
 * POST /api/v1/payouts/:id/settle — record the bank transfer for a released payout.
 *
 * Only while payouts are paid by hand (PAYMENT_PROVIDER=manual). This is the moment
 * the ledger is written, so it asks for the password again like release does.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: settlePayoutSchema,
      permission: 'payout.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        settlePayout({
          payoutId: input.id,
          actorId: session.userId,
          bankReference: input.bankReference,
          paidOn: input.paidOn,
        }),
    },
    params,
  );
}
