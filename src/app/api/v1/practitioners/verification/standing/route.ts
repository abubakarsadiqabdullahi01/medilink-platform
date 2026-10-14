import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { recordStandingSchema } from '@/modules/practitioners/presentation/schemas';
import { recordPractitionerStanding } from '@/modules/practitioners/application/verification';

/**
 * POST /api/v1/practitioners/verification/standing — where somebody stands on the
 * register: their level within the profession and their registration category
 * (PRA-01, PRA-02).
 *
 * PLATFORM-scoped on the permission that records the registration it rests on. A
 * practitioner cannot set their own: a level is something an officer reads off the
 * register, not something somebody claims.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: recordStandingSchema,
    permission: 'credential.review',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) =>
      recordPractitionerStanding({ ...input, actorId: session.userId }),
  });
}
