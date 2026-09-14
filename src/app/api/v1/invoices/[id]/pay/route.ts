import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { invoiceActionSchema } from '@/modules/billing-settlement/presentation/schemas';
import { recordPayment } from '@/modules/billing-settlement/application/invoice';

/**
 * POST /api/v1/invoices/:id/pay — records that a facility has paid.
 *
 * **This records a payment; it does not take one.** Capturing money needs a
 * provider, which is step 3.3 and unsettled, so an operator marks an invoice
 * paid against a bank transfer they can see. That is how a pilot runs before
 * a gateway exists, and the ledger entry it writes is the same either way.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: invoiceActionSchema,
      permission: 'payout.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        recordPayment({ invoiceId: input.id, actorId: session.userId }),
    },
    params,
  );
}
