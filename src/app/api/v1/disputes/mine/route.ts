import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { listDisputesForPractitioner } from '@/modules/disputes/application/dispute';

/**
 * GET /api/v1/disputes/mine — every case over this practitioner's own shifts, whoever raised it.
 *
 * Their own by the shift's assignee, and nothing they type: there is no id here to change. It says
 * which cases are waiting for their reply. A party reads each without who raised, replied to or
 * decided it.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: z.object({}),
    permission: 'dispute.manage',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ session }) => ({ disputes: await listDisputesForPractitioner(session.userId) }),
  });
}
