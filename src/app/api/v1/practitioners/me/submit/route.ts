import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { getProfileSchema } from '@/modules/practitioners/presentation/schemas';
import { submitForReview } from '@/modules/practitioners/application/application-review';
import { getAvailability } from '@/modules/availability/application/availability';

/**
 * POST /api/v1/practitioners/me/submit — "I am done, review me."
 *
 * SELF only, on the permission that already lets somebody write their own
 * profile: submitting is a statement about their own application and gives
 * them no access to anybody else's. The route is where the two modules meet —
 * availability is the availability module's to read, so it is asked here and
 * the answer handed to the practitioners module, which does not read that
 * module's tables.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: getProfileSchema,
    permission: 'practitioner.profile.write',
    scope: (_input, session) => ({ type: 'SELF' as const, id: session.userId }),
    action: async ({ session }) => {
      const availability = await getAvailability(session.userId);
      return submitForReview({
        userId: session.userId,
        hasAvailability: availability.slots.length > 0,
      });
    },
  });
}
