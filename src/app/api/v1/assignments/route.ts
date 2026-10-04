import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { listAssignmentsSchema } from '@/modules/matching/presentation/schemas';
import { listAssignments } from '@/modules/matching/application/assignment';

/**
 * GET /api/v1/assignments — a practitioner's own schedule, or a facility's.
 *
 * This is step 6.7's schedule list; the conflict detection that keeps it
 * consistent lives on the confirmation path.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listAssignmentsSchema,
    permission: 'service_request.read',
    scope: (input, session) => ({
      type: input.scopeType,
      id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
    }),
    action: async ({ input, session }) => {
      const scopeId = input.scopeType === 'SELF' ? session.userId : input.scopeId;
      if (!scopeId) return { assignments: [], nextCursor: null };
      return listAssignments({
        scopeType: input.scopeType,
        scopeId,
        status: input.status,
        serviceRequestId: input.serviceRequestId,
        search: input.search,
        from: input.from,
        to: input.to,
        limit: input.limit,
        cursor: input.cursor,
      });
    },
  });
}
