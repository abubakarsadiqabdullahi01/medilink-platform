import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  createServiceRequestSchema,
  listServiceRequestsSchema,
} from '@/modules/service-requests/presentation/schemas';
import {
  createServiceRequest,
  listServiceRequests,
} from '@/modules/service-requests/application/request';

/**
 * /api/v1/service-requests — draft a request (POST) or list them (GET).
 *
 * Creating leaves the request in DRAFT. Publishing is a separate step,
 * because publishing is what puts work in front of practitioners and is the
 * point at which the facility's own verification is checked.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: createServiceRequestSchema,
    permission: 'service_request.publish',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ input, session }) =>
      createServiceRequest({ ...input, actorId: session.userId }),
    successStatus: 201,
  });
}

export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listServiceRequestsSchema,
    permission: 'service_request.read',
    scope: (input) => ({ type: input.scopeType, id: input.scopeId }),
    action: async ({ input }) => listServiceRequests(input),
  });
}
