import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { requestActionSchema } from '@/modules/service-requests/presentation/schemas';
import { getServiceRequest } from '@/modules/service-requests/application/request';

/**
 * GET /api/v1/service-requests/:id — one request.
 *
 * `facilityId` is a required query parameter because it carries the
 * authorisation scope, which is checked before any database read.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: requestActionSchema,
      permission: 'service_request.read',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input }) =>
        getServiceRequest({ requestId: input.id, facilityId: input.facilityId }),
    },
    params,
  );
}
