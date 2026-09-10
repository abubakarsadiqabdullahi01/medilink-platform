import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { verificationQuerySchema } from '@/modules/practitioners/presentation/schemas';
import { getVerificationSummary } from '@/modules/practitioners/application/verification';

/**
 * GET /api/v1/practitioners/verification — identity and professional
 * registration for one practitioner.
 *
 * SELF for their own record, PLATFORM for compliance looking at someone
 * else's, following the same "the caller states the scope" pattern as the
 * audit trail and the credential queue.
 *
 * The NIN is never in the response: only its last four digits and whether the
 * name matched.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: verificationQuerySchema,
    permission: 'practitioner.profile.read',
    scope: (input, session) => ({
      type: input.scopeType,
      id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
    }),
    action: async ({ input, session }) => {
      // Reached only once the guard has confirmed any SELF scopeId is the
      // caller's own. A PLATFORM caller must name whose record they want.
      const userId = input.scopeType === 'SELF' ? session.userId : input.scopeId;
      if (!userId) {
        return { userId: null, identity: null, registrations: [] };
      }
      return getVerificationSummary(userId);
    },
  });
}
