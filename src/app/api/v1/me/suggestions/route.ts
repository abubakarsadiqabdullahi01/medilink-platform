import { handleSessionRequest } from '@/lib/http/session-handler';
import { listMySuggestions } from '@/modules/suggestions/application/suggestion';

/**
 * GET /api/v1/me/suggestions — what the caller has written, where each stands, and the answer (SUG-01).
 *
 * Any signed-in person may read their own, so it asks for a session and no permission. What keeps it
 * safe is that the author is the session's user and never a parameter: there is no way to name
 * somebody else's, and a decline reason, which has no author, is never in it.
 */
export async function GET(request: Request) {
  return handleSessionRequest(request, async (session) => ({
    suggestions: await listMySuggestions(session.userId),
  }));
}
