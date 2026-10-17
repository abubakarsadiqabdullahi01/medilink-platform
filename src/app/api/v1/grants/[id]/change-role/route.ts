import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { changeRoleSchema } from '@/modules/auth/presentation/grant-schemas';
import { changeGrantRole, holdsPlatformAuthority } from '@/modules/auth/application/grants';
import { loadGrants } from '@/lib/authz/guard';

/**
 * POST /api/v1/grants/:id/change-role — make somebody's role something else, in one step.
 *
 * Removing and granting were the only way, which leaves the person with no access in between and
 * two rows in the record that nobody can tell are one decision. Here the old role ends and the new
 * one begins together, and every rule that applies to granting and to revoking applies: nobody
 * gives a role they do not hold, and a facility's last owner cannot be made something else.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: changeRoleSchema,
      permission: 'role.grant',
      scope: (input) => ({ type: input.scopeType, id: input.scopeId }),
      action: async ({ input, session }) => {
        const grants = await loadGrants(session.userId);
        return changeGrantRole({
          grantId: input.id,
          newRoleKey: input.roleKey,
          scope: { type: input.scopeType, id: input.scopeId },
          actorId: session.userId,
          reason: input.reason,
          actorPermissions: grants.map((grant) => grant.permission),
          actorIsPlatform: holdsPlatformAuthority(grants),
        });
      },
    },
    params,
  );
}
