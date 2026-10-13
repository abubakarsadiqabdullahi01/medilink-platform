import { requestContextFrom } from '@/lib/http/request-context';
import { fail, ok } from '@/lib/http/responses';
import { sessionState } from '@/modules/auth/application/session-state';

/**
 * GET /api/v1/auth/session — who the caller is and what they may do.
 *
 * Returns permissions rather than roles: the client should hide a button
 * because the permission is absent, matching the server-side check exactly.
 */
export async function GET(request: Request) {
  const context = requestContextFrom(request);
  const state = await sessionState();
  if (!state) return fail('not_authenticated', 'Sign in to continue.', context, 401);
  return ok(state, context);
}
