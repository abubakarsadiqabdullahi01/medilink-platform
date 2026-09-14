import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  generateInvoiceSchema,
  listInvoicesSchema,
} from '@/modules/billing-settlement/presentation/schemas';
import { generateInvoice, listInvoices } from '@/modules/billing-settlement/application/invoice';

/**
 * POST /api/v1/invoices — raise a draft from approved work in a period.
 *
 * PLATFORM-scoped rather than the facility's own act: a facility that could
 * issue its own invoices could decide what it owes. Only shifts already
 * approved are billed, so nothing here can charge for hours the facility has
 * not accepted.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: generateInvoiceSchema,
    permission: 'payout.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) =>
      generateInvoice({ ...input, actorId: session.userId }),
  });
}

/** GET — a facility's own invoices. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listInvoicesSchema,
    permission: 'invoice.read',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ input }) => ({ invoices: await listInvoices(input.facilityId) }),
  });
}
