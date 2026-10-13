import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { listPlatformInvoices } from '@/modules/billing-settlement/application/finance-summary';

const schema = z.object({
  status: z.enum(['DRAFT', 'ISSUED', 'PAID']).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

/**
 * GET /api/v1/finance/invoices — every invoice across the platform, one page at
 * a time. Replaces asking each facility for its own, which was one request per
 * facility. `invoice.read` at PLATFORM.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema,
    permission: 'invoice.read',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) => listPlatformInvoices(input),
  });
}
