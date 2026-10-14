import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { evidenceUploadUrlSchema, partyScope } from '@/modules/disputes/presentation/schemas';
import { requestEvidenceUploadUrl } from '@/modules/disputes/application/evidence';

/**
 * POST /api/v1/disputes/:id/evidence/upload-url — a signed URL the browser
 * uploads straight to, so the file never passes through this application.
 *
 * The same shape credential documents already use.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: evidenceUploadUrlSchema,
      permission: 'dispute.manage',
      scope: partyScope,
      action: async ({ input, session }) =>
        requestEvidenceUploadUrl({
          disputeId: input.id,
          userId: session.userId,
          filename: input.filename,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
        }),
    },
    params,
  );
}
