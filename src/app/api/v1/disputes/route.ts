import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { listQuerySchema } from '@/modules/disputes/presentation/schemas';
import { listLiveDisputes } from '@/modules/disputes/application/dispute';

/** GET /api/v1/disputes — the adjudicator's queue, oldest first. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listQuerySchema,
    permission: 'dispute.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => ({ disputes: await listLiveDisputes() }),
  });
}
