import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { removeAccessSchema } from '@/modules/auth/presentation/grant-schemas';
import { holdsPlatformAuthority, revokeAllAccess } from '@/modules/auth/application/grants';
import { loadGrants } from '@/lib/authz/guard';

/**
 * POST /api/v1/grants/remove-access — take away all of somebody's access over a scope, now.
 *
 * For when removing one role at a time is the risk: somebody who has left and kept the keys, an
 * account that may be in somebody else's hands. Every grant they hold over the scope ends in one
 * transaction or none does; what they hold elsewhere is not touched. Access is read on every
 * request, so it is gone on their next one. At a facility the person, and the facility's other
 * owners, are told.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: removeAccessSchema,
    permission: 'role.grant',
    scope: (input) => ({ type: input.scopeType, id: input.scopeId }),
    action: async ({ input, session }) => {
      const grants = await loadGrants(session.userId);
      return revokeAllAccess({
        userId: input.userId,
        scope: { type: input.scopeType, id: input.scopeId },
        actorId: session.userId,
        reason: input.reason,
        actorPermissions: grants.map((grant) => grant.permission),
        actorIsPlatform: holdsPlatformAuthority(grants),
      });
    },
  });
}
