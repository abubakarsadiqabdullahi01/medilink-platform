import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { invitationsQuerySchema } from '@/modules/matching/presentation/schemas';
import { listInvitationsFor } from '@/modules/matching/application/assignment';

/** GET /api/v1/invitations — what this practitioner has been asked to work. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: invitationsQuerySchema,
    permission: 'service_request.read',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ session }) => ({ invitations: await listInvitationsFor(session.userId) }),
  });
}
