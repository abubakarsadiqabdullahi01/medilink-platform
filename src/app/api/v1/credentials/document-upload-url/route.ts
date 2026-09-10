import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { requestDocumentUploadUrlSchema } from '@/modules/credentials/presentation/schemas';
import { requestDocumentUploadUrl } from '@/modules/credentials/application/submission';

/**
 * POST /api/v1/credentials/document-upload-url — a signed Tigris PUT URL for
 * a credential document. Bytes never pass through the app; the client
 * uploads directly, then references the returned objectKey when submitting.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: requestDocumentUploadUrlSchema,
    permission: 'credential.submit',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ input, session }) =>
      requestDocumentUploadUrl({ ...input, userId: session.userId }),
  });
}
