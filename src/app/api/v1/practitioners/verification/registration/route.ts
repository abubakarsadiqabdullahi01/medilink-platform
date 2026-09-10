import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { recordRegistrationSchema } from '@/modules/practitioners/presentation/schemas';
import { recordProfessionalRegistration } from '@/modules/practitioners/application/verification';

/**
 * POST /api/v1/practitioners/verification/registration — step 5.5.
 *
 * What the regulator's register showed, and when we looked. The retrieval
 * date is the substance of this record: a licence checked two years ago is
 * not evidence that someone may work a shift tomorrow, and `isEvidenceStale`
 * is what says so.
 *
 * PLATFORM-scoped, and manual by default — `MDCN_VERIFICATION_PROVIDER=none`
 * until a subscription exists.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: recordRegistrationSchema,
    permission: 'credential.review',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) =>
      recordProfessionalRegistration({
        userId: input.userId,
        regulator: input.regulator,
        folioNumber: input.folioNumber,
        registrationStatus: input.registrationStatus,
        practiceType: input.practiceType,
        location: input.location,
        expiresAt: input.expiresAt,
        actorId: session.userId,
      }),
    successStatus: 201,
  });
}
