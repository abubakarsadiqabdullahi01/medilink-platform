import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { eligibilityQuerySchema } from '@/modules/practitioners/presentation/schemas';
import { getEligibility } from '@/modules/practitioners/application/eligibility';

/**
 * GET /api/v1/practitioners/eligibility — every reason one practitioner is
 * not yet eligible to be matched, or none.
 *
 * SELF for a practitioner checking their own account, PLATFORM for
 * compliance looking at someone else's — the same "the caller states the
 * scope" pattern as /verification and the credential queue. Nothing here
 * changes state: activation itself only happens on the nightly sweep
 * (activateEligiblePractitioners), never as a side effect of reading this.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: eligibilityQuerySchema,
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
        return { eligible: false, blockers: ['account_not_usable'] };
      }
      return getEligibility(userId);
    },
  });
}
