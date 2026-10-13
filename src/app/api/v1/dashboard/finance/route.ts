import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { financeSummary } from '@/modules/billing-settlement/application/finance-summary';

/**
 * GET /api/v1/dashboard/finance — the totals, the monthly figures and the
 * largest outstanding balances, summed in the database. `invoice.read` at
 * PLATFORM, like the Finance page it serves.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: z.object({}),
    permission: 'invoice.read',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => financeSummary(),
  });
}
