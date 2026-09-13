import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  listExcusalsSchema,
  requestExcusalSchema,
} from '@/modules/cancellations-sanctions/presentation/schemas';
import {
  listExcusals,
  requestExcusal,
} from '@/modules/cancellations-sanctions/application/excusal';

/**
 * POST /api/v1/assignments/:id/excusals — step 7.8. The practitioner asks.
 *
 * SELF-scoped, and the application layer checks the assignment is theirs:
 * the scope guard proves who is asking, not what they are asking about.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: requestExcusalSchema,
      permission: 'attendance.record',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) =>
        requestExcusal({
          assignmentId: input.id,
          userId: session.userId,
          reason: input.reason,
        }),
    },
    params,
  );
}

/**
 * GET — every request on this assignment, refusals included. Both outcomes
 * are retained, and this is where that is legible.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: listExcusalsSchema,
      permission: 'attendance.record',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input }) => ({ excusals: await listExcusals(input.id) }),
    },
    params,
  );
}
