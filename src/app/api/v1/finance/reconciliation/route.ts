import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { reconcileLedger } from '@/modules/billing-settlement/application/reconciliation';

/**
 * GET /api/v1/finance/reconciliation: does the money add up, worked out now. Every finding is
 * about an id and an amount, never a name, so `invoice.read` at PLATFORM, like the Finance page it
 * serves, is enough. It reads and changes nothing, so it does not ask for the password again.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: z.object({}),
    permission: 'invoice.read',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => reconcileLedger(),
  });
}
