import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { reviewCredentialSchema } from '@/modules/credentials/presentation/schemas';
import { reviewCredential } from '@/modules/credentials/application/submission';

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
      action: async ({ input, session }) =>
        reviewCredential({
          submissionId: input.id,
          reviewerId: session.userId,
          decision: input.decision,
          reviewNotes: input.reviewNotes,
        }),
    },
    params,
  );
}
