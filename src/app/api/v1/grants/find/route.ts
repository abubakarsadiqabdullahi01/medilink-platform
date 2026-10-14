import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { findUserSchema } from '@/modules/auth/presentation/grant-schemas';
import { findUserByPhone } from '@/modules/auth/application/grants';
import { assertScopeMayAddStaff } from '@/modules/facilities/application/facility';
import { normalizeNigerianPhone } from '@/lib/phone';

/**
 * GET /api/v1/grants/find — look somebody up by the number they registered
 * with, so a grant can be made without anybody copying a uuid.
 *
 * Returns a name, a number and a status and nothing else: this is reached by
 * whoever can already grant access over the scope, and it should not become a
 * way to enumerate the platform's practitioners.
 *
 * For a facility, that is only once the facility is verified. Registering one
 * makes the registrant its owner and the owner holds `role.grant`, so without
 * the check below anybody could become a directory search by registering a
 * hospital (AUT-07). The check is after the guard, so someone who does not hold
 * the permission is refused before they learn anything about the facility.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: findUserSchema,
    permission: 'role.grant',
    scope: (input) => ({ type: input.scopeType, id: input.scopeId }),
    // Normalised as /users/find does: registration stores +234…, and an owner
    // adding a colleague types the number the way it is written down. Without
    // this, "0803 123 4567" was a 404 for somebody who plainly exists.
    action: async ({ input, session }) => {
      await assertScopeMayAddStaff({ type: input.scopeType, id: input.scopeId }, session.userId);
      return findUserByPhone(normalizeNigerianPhone(input.phone));
    },
  });
}
