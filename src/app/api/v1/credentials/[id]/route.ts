import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { resupplyCredentialSchema } from '@/modules/credentials/presentation/schemas';
import { resupplyCredential } from '@/modules/credentials/application/submission';

/**
 * PATCH /api/v1/credentials/:id — the practitioner's answer to a reviewer's
 * request for more information.
 *
 * SELF-scoped, and reachable only from MORE_INFO_REQUESTED. It is not a
 * general edit path for a pending submission: a reviewer must never be
 * looking at one version while the practitioner replaces it underneath them.
 */
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: resupplyCredentialSchema,
      permission: 'credential.submit',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) =>
        resupplyCredential({
          submissionId: input.id,
          userId: session.userId,
          referenceNumber: input.referenceNumber,
          documentObjectKey: input.documentObjectKey,
        }),
    },
    params,
  );
}
