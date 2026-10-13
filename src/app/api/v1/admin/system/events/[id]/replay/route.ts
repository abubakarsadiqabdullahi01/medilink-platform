import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { replayEvent } from '@/modules/audit-compliance/application/system-status';

/**
 * POST /api/v1/admin/system/events/:id/replay — put an event that gave up back
 * to be delivered. `system.manage` at PLATFORM: replaying sends the texts and
 * runs the recomputations the event was for.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: z.object({ id: z.string().uuid() }),
      permission: 'system.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        replayEvent({ eventId: input.id, actorId: session.userId }),
    },
    params,
  );
}
