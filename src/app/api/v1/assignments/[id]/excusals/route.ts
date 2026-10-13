import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  listExcusalsSchema,
  requestExcusalSchema,
} from '@/modules/cancellations-sanctions/presentation/schemas';
import {
  listExcusals,
  requestExcusal,
} from '@/modules/cancellations-sanctions/application/excusal';
import { getAssignmentInScope } from '@/modules/matching/application/assignment';

/**
 * POST /api/v1/assignments/:id/excusals — step 7.8. The practitioner asks.
 *
 * SELF-scoped, and the application layer checks the assignment is theirs:
 * the scope guard proves who is asking, not what they are asking about.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
 *
 * Two readers. The practitioner asks at SELF, and the shift in the path must
 * be theirs: the scope check alone only proved they were asking as
 * themselves, so naming somebody else's assignment id used to return that
 * person's reasons — which are often medical. The officer deciding the flag
 * asks at PLATFORM, on the permission that decides it.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const platform = new URL(request.url).searchParams.get('scopeType') === 'PLATFORM';

  if (platform) {
    return handleGuardedRequest(
      request,
      {
        source: 'query',
        schema: listExcusalsSchema,
        permission: 'sanction.apply',
        scope: () => ({ type: 'PLATFORM' }),
        action: async ({ input }) => ({ excusals: await listExcusals(input.id) }),
      },
      params,
    );
  }

  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: listExcusalsSchema,
      permission: 'attendance.record',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) => {
        await getAssignmentInScope({ assignmentId: input.id, scopeType: 'SELF', scopeId: session.userId });
        return { excusals: await listExcusals(input.id) };
      },
    },
    params,
  );
}
