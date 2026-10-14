import { z } from 'zod';
import { HttpError } from '@/lib/http/errors';
import { handleSessionRequest } from '@/lib/http/session-handler';
import { INBOX_MAX_LIMIT, listInbox } from '@/modules/notifications/application/inbox';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(INBOX_MAX_LIMIT).optional(),
});

/**
 * GET /api/v1/me/notifications — what the platform has sent the caller.
 *
 * Any signed-in person may read their own, so it asks for a session and no
 * permission. What keeps it safe is that the owner is the session's user and
 * never a parameter: there is no way to name somebody else's.
 */
export async function GET(request: Request) {
  return handleSessionRequest(request, async (session) => {
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new HttpError('validation_failed', 'That is not a valid request.', 422);
    return listInbox(session.userId, { limit: parsed.data.limit });
  });
}
