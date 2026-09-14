import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { invoiceActionSchema } from '@/modules/billing-settlement/presentation/schemas';
import { issueInvoice } from '@/modules/billing-settlement/application/invoice';

/** POST /api/v1/invoices/:id/issue — a draft becomes something payable. */
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
        issueInvoice({ invoiceId: input.id, actorId: session.userId }),
    },
    params,
  );
}
