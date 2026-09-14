import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { documentUrlSchema } from '@/modules/credentials/presentation/schemas';
import { requestDocumentDownloadUrl } from '@/modules/credentials/application/submission';

/**
 * POST /api/v1/credentials/:id/document-url — a signed Tigris GET URL for
 * one submission's document. SELF for the owning practitioner, PLATFORM for
 * a reviewer. A submission that exists but belongs to someone else at SELF
 * scope is 404 inside requestDocumentDownloadUrl, not 403 — see that
 * function's own comment.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: documentUrlSchema,
      permission: 'credential.document.read',
      scope: (input, session) => ({
        type: input.scopeType,
        id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
      }),
      action: async ({ input, session }) => {
        const scopeId =
          input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId;
        return requestDocumentDownloadUrl({
          submissionId: input.id,
          scopeType: input.scopeType,
          scopeId,
          viewerId: session.userId,
        });
      },
    },
    params,
  );
}
