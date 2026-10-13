import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { reviewCredentialSchema } from '@/modules/credentials/presentation/schemas';
import {
  getSubmissionForVerification,
  reviewCredential,
} from '@/modules/credentials/application/submission';
import { isReferenceChecked } from '@/modules/credentials/domain/submission';
import { CredentialErrors } from '@/modules/credentials/domain/errors';

/**
 * POST /api/v1/credentials/:id/review — approve or reject a submission.
 * PLATFORM-scoped only: there is no SELF-scoped variant, and reviewCredential
 * itself refuses a reviewer acting on their own submission even if they hold
 * both roles.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: reviewCredentialSchema,
      permission: 'credential.review',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) => {
        // Approving a NIN or a licence number is not just "mark it good": it has
        // to record the identity or registration that eligibility reads, which
        // is what /practitioners/verification/confirm does. Rejecting or asking
        // for more records nothing and stays here.
        if (input.decision === 'approve') {
          const submission = await getSubmissionForVerification(input.id);
          if (isReferenceChecked(submission.verificationMethod)) {
            // Your own submission is refused as that, whichever way it is reviewed:
            // "confirm it elsewhere" would be advice you cannot follow either.
            if (submission.userId === session.userId) {
              throw CredentialErrors.cannotReviewOwnSubmission();
            }
            throw CredentialErrors.confirmThroughPractitioner();
          }
        }
        return reviewCredential({
          submissionId: input.id,
          reviewerId: session.userId,
          decision: input.decision,
          reviewNotes: input.reviewNotes,
        });
      },
    },
    params,
  );
}
