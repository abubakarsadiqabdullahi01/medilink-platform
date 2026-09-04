import { requestContextFrom } from '@/lib/http/request-context';
import { ok } from '@/lib/http/responses';
import { currentSession, revokeSession } from '@/modules/auth/application/session-service';

/**
 * POST /api/v1/auth/logout — revokes the current session.
 *
 * Idempotent and always 200: a client clearing a stale cookie should not have
 * to handle an error.
 */
export async function POST(request: Request) {
  const context = requestContextFrom(request);
  const session = await currentSession();

  if (session) {
    await revokeSession({
      sessionId: session.sessionId,
      actorId: session.userId,
      reason: 'User signed out',
    });
  }

  return ok({ status: 'signed_out' }, context);
}
