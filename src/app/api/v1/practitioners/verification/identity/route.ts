import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { recordIdentitySchema } from '@/modules/practitioners/presentation/schemas';
import { recordIdentityVerification } from '@/modules/practitioners/application/verification';

/**
 * POST /api/v1/practitioners/verification/identity — step 5.3.
 *
 * PLATFORM-scoped: a practitioner does not verify their own identity, which
 * is the whole point. With `NIN_VERIFICATION_PROVIDER=none` — the default,
 * because no subscription exists — a compliance officer records what the
 * identity slip showed. Switching a provider on changes where the evidence
 * comes from, not this endpoint.
 *
 * The raw NIN reaches the service, is turned into a keyed digest and its last
 * four digits, and is never stored, logged, audited or returned.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: recordIdentitySchema,
    permission: 'credential.review',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) =>
      recordIdentityVerification({
        userId: input.userId,
        nin: input.nin,
        nameMatch: input.nameMatch,
        actorId: session.userId,
      }),
    successStatus: 201,
  });
}
