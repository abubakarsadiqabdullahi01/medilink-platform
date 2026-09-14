import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { facilityIdSchema } from '@/modules/facilities/presentation/schemas';
import { requestLicenceDownloadUrl } from '@/modules/facilities/application/facility';

/**
 * POST /api/v1/facilities/:id/licence-url — a short-lived signed GET URL for
 * the facility's licence document.
 *
 * POST rather than GET because it mints a credential rather than returning a
 * cacheable resource, matching credentials/:id/document-url. Reachable by the
 * facility itself and, through a PLATFORM grant, by compliance — the two
 * parties with a reason to look at it.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: facilityIdSchema,
      permission: 'facility.read',
      scope: (input) => ({ type: 'FACILITY', id: input.id }),
      action: async ({ input, session }) =>
        requestLicenceDownloadUrl({ facilityId: input.id, viewerId: session.userId }),
    },
    params,
  );
}
