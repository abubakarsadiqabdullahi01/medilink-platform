import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { requestInvitationsSchema } from '@/modules/matching/presentation/schemas';
import { listInvitationsForRequest } from '@/modules/matching/application/assignment';

/**
 * GET /api/v1/service-requests/:id/invitations — who this shift was offered
 * to, and what each of them answered.
 *
 * Read on `service_request.read` rather than the `assignment.confirm` that
 * sending an offer needs: seeing who has been asked is part of reading the
 * shift, and the page already hides the controls from somebody who cannot act.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: requestInvitationsSchema,
      permission: 'service_request.read',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input }) => ({
        invitations: await listInvitationsForRequest({
          requestId: input.id,
          facilityId: input.facilityId,
        }),
      }),
    },
    params,
  );
}
