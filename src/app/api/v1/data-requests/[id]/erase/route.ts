import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { executeErasure } from '@/modules/audit-compliance/application/erasure';

/**
 * POST /api/v1/data-requests/:id/erase — carry out an erasure request that has
 * been picked up: replace the person's details, delete their files, close the
 * account.
 *
 * `data.erase` at PLATFORM, which needs a fresh password: this is not undone.
 * Pressing it again after a failure finishes any files that were left.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: z.object({ id: z.string().uuid() }),
      permission: 'data.erase',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        executeErasure({ requestId: input.id, actorId: session.userId }),
    },
    params,
  );
}
