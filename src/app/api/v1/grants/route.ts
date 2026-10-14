import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { grantRoleSchema, listGrantsSchema } from '@/modules/auth/presentation/grant-schemas';
import { loadGrants, type Grant } from '@/lib/authz/guard';
import { grantRole, listGrants, grantableRoles } from '@/modules/auth/application/grants';
import { assertScopeMayAddStaff } from '@/modules/facilities/application/facility';

/**
 * POST /api/v1/grants — give somebody a role over a scope.
 *
 * Scoped to the thing being granted over, not to PLATFORM: a facility
 * administrator manages their own staff, and a platform holder can do it
 * anywhere because a PLATFORM grant covers every scope.
 *
 * `role.grant` requires step-up authentication, which the guard enforces —
 * it is the permission that decides what everybody else may do.
 *
 * A facility may add people only once it is verified (AUT-07): the guard proves
 * the permission and the scope, and neither says anything about whether the
 * facility has been checked. Run after the guard, so the answer is only ever
 * given to somebody who held the permission.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: grantRoleSchema,
    permission: 'role.grant',
    scope: (input) => ({ type: input.scopeType, id: input.scopeId }),
    action: async ({ input, session }) => {
      await assertScopeMayAddStaff({ type: input.scopeType, id: input.scopeId }, session.userId);
      return grantRole({
        userId: input.userId,
        roleKey: input.roleKey,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        actorId: session.userId,
        // The escalation check: nobody can grant what they do not hold. The
        // session carries only an id, so the grants are loaded here — the
        // same list the guard itself resolves against.
        actorPermissions: (await loadGrants(session.userId)).map(
          (grant: Grant) => grant.permission,
        ),
      });
    },
  });
}

/** GET — who holds what over this scope, revoked grants included. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listGrantsSchema,
    permission: 'role.grant',
    scope: (input) => ({ type: input.scopeType, id: input.scopeId }),
    action: async ({ input }) => ({
      grants: await listGrants({ scopeType: input.scopeType, scopeId: input.scopeId }),
      roles: grantableRoles(),
    }),
  });
}
