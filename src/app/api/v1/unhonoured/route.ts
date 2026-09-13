import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { listUnhonouredSchema } from '@/modules/cancellations-sanctions/presentation/schemas';
import { listAwaitingFault } from '@/modules/cancellations-sanctions/application/fault';

/**
 * GET /api/v1/unhonoured — the queue a person works through.
 *
 * The sweep flags; this is where the flags wait. Nothing ages out of here on
 * its own, because an unhonoured assignment with no decision is unfinished
 * business rather than a stale row.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listUnhonouredSchema,
    permission: 'sanction.apply',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => ({ unhonoured: await listAwaitingFault() }),
  });
}
