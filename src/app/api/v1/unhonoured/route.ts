import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { listUnhonouredSchema } from '@/modules/cancellations-sanctions/presentation/schemas';
import { listUnhonoured } from '@/modules/cancellations-sanctions/application/fault';

/**
 * GET /api/v1/unhonoured — the queue a person works through.
 *
 * The sweep flags; this is where the flags wait. Nothing ages out of here on
 * its own, because an unhonoured assignment with no decision is unfinished
 * business rather than a stale row.
 *
 * `status=CLOSED` reads the decisions already made. Without it there was no
 * way to see what was decided about a shift last month, which is a poor
 * property for the record of who was held answerable for an absence.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listUnhonouredSchema,
    permission: 'sanction.apply',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) => listUnhonoured(input),
  });
}
