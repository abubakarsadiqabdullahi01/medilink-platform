import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { runMatchSchema } from '@/modules/matching/presentation/schemas';
import { runMatch } from '@/modules/matching/application/match';

/**
 * POST /api/v1/service-requests/:id/match — who could work this shift, in
 * order, and why.
 *
 * A POST rather than a GET because it records a run: step 6.3 requires that
 * "for any candidate, why they ranked where they did" survives the request
 * that produced it, and a ranking nobody can revisit explains nothing.
 *
 * `assignment.confirm` rather than `service_request.read`: running a match
 * puts names in front of a facility, which is closer to confirming somebody
 * than to reading a request.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: runMatchSchema,
      permission: 'assignment.confirm',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        runMatch({
          requestId: input.id,
          facilityId: input.facilityId,
          actorId: session.userId,
        }),
      successStatus: 201,
    },
    params,
  );
}
