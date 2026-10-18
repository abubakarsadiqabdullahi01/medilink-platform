import { handleSessionRequest } from '@/lib/http/session-handler';
import { listMyInvitations } from '@/modules/auth/application/staff-invitations';

/**
 * GET /api/v1/staff-invitations/mine — the invitations waiting for the caller's own number.
 *
 * Open to any signed-in person and to nothing else about anybody: a person with no role at all,
 * which is what somebody invited to their first facility is, holds no permission to name, and the
 * only invitations it can reach are for the number they have verified.
 */
export async function GET(request: Request) {
  return handleSessionRequest(request, async (session) => ({
    invitations: await listMyInvitations({ userId: session.userId }),
  }));
}
