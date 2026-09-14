import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { findUserSchema } from '@/modules/auth/presentation/grant-schemas';
import { findUserByPhone } from '@/modules/auth/application/grants';

/**
 * GET /api/v1/grants/find — look somebody up by the number they registered
 * with, so a grant can be made without anybody copying a uuid.
 *
 * Returns a name, a number and a status and nothing else: this is reached by
 * whoever can already grant access over the scope, and it should not become a
 * way to enumerate the platform's practitioners.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: findUserSchema,
    permission: 'role.grant',
    scope: (input) => ({ type: input.scopeType, id: input.scopeId }),
    action: async ({ input }) => findUserByPhone(input.phone),
  });
}
