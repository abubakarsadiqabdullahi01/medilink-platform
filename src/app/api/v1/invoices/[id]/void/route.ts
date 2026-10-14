import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { voidInvoiceSchema } from '@/modules/billing-settlement/presentation/schemas';
import { voidInvoice } from '@/modules/billing-settlement/application/invoice';

/**
 * POST /api/v1/invoices/:id/void — cancel a draft, reversing what was credited.
 *
 * A reason is required: this is the act that undoes a bill, and "why" is the
 * first thing anybody asks. Only a draft can be voided; see `voidInvoice`.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: voidInvoiceSchema,
      permission: 'payout.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        voidInvoice({ invoiceId: input.id, actorId: session.userId, reason: input.reason }),
    },
    params,
  );
}
