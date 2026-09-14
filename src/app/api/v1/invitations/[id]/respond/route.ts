import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { respondSchema } from '@/modules/matching/presentation/schemas';
import { respondToInvitation } from '@/modules/matching/application/assignment';

/**
 * POST /api/v1/invitations/:id/respond — accept or decline.
 *
 * Accepting is not being confirmed: the facility still decides, and this only
 * says the practitioner is willing. Someone else's invitation is a 404 rather
 * than a 403, folding ownership into the lookup.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: respondSchema,
      permission: 'service_request.read',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) =>
        respondToInvitation({
          invitationId: input.id,
          userId: session.userId,
          decision: input.decision,
          reason: input.reason,
        }),
    },
    params,
  );
}
