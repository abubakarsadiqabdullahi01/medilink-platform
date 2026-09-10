import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { requestActionSchema } from '@/modules/service-requests/presentation/schemas';
import { publishServiceRequest } from '@/modules/service-requests/application/request';

/**
 * POST /api/v1/service-requests/:id/publish — put the request in front of
 * practitioners.
 *
 * This is where the Stage 5 gate condition "a facility must be verified
 * before it can publish" is finally enforced: `canPublish` has existed since
 * 5.10 with nothing calling it, and this is the call.
 *
 * The rate floor is re-checked here as well as at creation, because a floor
 * can move between drafting and publishing and the published rate is the one
 * that counts.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: requestActionSchema,
      permission: 'service_request.publish',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        publishServiceRequest({
          requestId: input.id,
          facilityId: input.facilityId,
          actorId: session.userId,
        }),
    },
    params,
  );
}
