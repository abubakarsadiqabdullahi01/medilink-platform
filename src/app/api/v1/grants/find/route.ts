import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { findUserSchema } from '@/modules/auth/presentation/grant-schemas';
import { findUserByPhone } from '@/modules/auth/application/grants';
import { normalizeNigerianPhone } from '@/lib/phone';
import { HttpError } from '@/lib/http/errors';
import { getFacility } from '@/modules/facilities/application/facility';

/**
 * GET /api/v1/grants/find — look somebody up by the number they registered
 * with, so a grant can be made without anybody copying a uuid.
 *
 * Returns a name, a number and a status and nothing else: this is reached by
 * whoever can already grant access over the scope, and it should not become a
 * way to enumerate the platform's practitioners.
 *
 * For a facility, only once it has been verified. A facility's representative
 * becomes its owner the moment it is registered, with `role.grant` in hand, so
 * without this anybody signed in could register a throwaway facility and use
 * the owner's lookup as a directory of everybody on the platform. The guard
 * proves the permission and the scope; it never looked at the facility's status.
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
    action: async ({ input }) => {
      if (input.scopeType === 'FACILITY' && input.scopeId) {
        const facility = await getFacility(input.scopeId);
        if (facility.status !== 'VERIFIED') {
          throw new HttpError(
            'facility_not_verified',
            'Adding staff opens once the facility has been verified.',
            403,
          );
        }
      }
      return findUserByPhone(normalizeNigerianPhone(input.phone));
    },
  });
}
