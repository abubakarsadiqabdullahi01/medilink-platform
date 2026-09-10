import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { cancelRequestSchema } from '@/modules/service-requests/presentation/schemas';
import { cancelServiceRequest } from '@/modules/service-requests/application/request';

/**
 * POST /api/v1/service-requests/:id/cancel — withdraw a request.
 *
 * `service_request.publish` rather than `assignment.cancel`: whoever may put
 * work in front of practitioners is who may withdraw it, and
 * `assignment.cancel` is about a confirmed person rather than an open
 * request. A reason is required — practitioners have already seen this.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: cancelRequestSchema,
      permission: 'service_request.publish',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        cancelServiceRequest({
          requestId: input.id,
          facilityId: input.facilityId,
          actorId: session.userId,
          reason: input.reason,
        }),
    },
    params,
  );
}
