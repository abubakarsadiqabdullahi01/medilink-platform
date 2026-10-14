import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { confirmFromSubmissionSchema } from '@/modules/practitioners/presentation/schemas';
import {
  confirmIdentityFromSubmission,
  confirmRegistrationFromSubmission,
} from '@/modules/practitioners/application/confirm-from-submission';

/**
 * POST /api/v1/practitioners/verification/confirm — confirm what a practitioner
 * submitted, in one act.
 *
 * Records the identity or registration from the NIN or licence number on the
 * submission and decides the submission, so an officer reads the photograph
 * beside the number and clicks once instead of retyping the number into another
 * form. See confirm-from-submission.ts for why, and for what stays the
 * officer's call.
 *
 * PLATFORM-scoped, on the same permission as the manual forms it sits beside.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: confirmFromSubmissionSchema,
    permission: 'credential.review',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) =>
      input.kind === 'identity'
        ? confirmIdentityFromSubmission({
            submissionId: input.submissionId,
            nameMatch: input.nameMatch,
            actorId: session.userId,
          })
        : confirmRegistrationFromSubmission({
            submissionId: input.submissionId,
            registrationStatus: input.registrationStatus,
            expiresAt: input.expiresAt,
            cadreLevelId: input.cadreLevelId,
            registrationCategoryId: input.registrationCategoryId,
            actorId: session.userId,
          }),
  });
}
