import { z } from 'zod';
import { HttpError } from '@/lib/http/errors';
import { handleSessionRequest } from '@/lib/http/session-handler';
import { markInboxRead } from '@/modules/notifications/application/inbox';

const bodySchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }),
]);

/**
 * POST /api/v1/me/notifications/read — mark some of the caller's messages, or all,
 * as read. Only the caller's own can change; another person's id does nothing.
 */
export async function POST(request: Request) {
  return handleSessionRequest(request, async (session) => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new HttpError('validation_failed', 'Say which messages: ids, or all.', 422);
    }
    return { marked: await markInboxRead(session.userId, parsed.data) };
  });
}
