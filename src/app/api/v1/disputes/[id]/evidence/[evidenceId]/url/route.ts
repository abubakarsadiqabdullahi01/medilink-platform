import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { evidenceUrlSchema } from '@/modules/disputes/presentation/schemas';
import { requestEvidenceDownloadUrl } from '@/modules/disputes/application/evidence';

/**
 * POST /api/v1/disputes/:id/evidence/:evidenceId/url — a short-lived link to
 * one attachment.
 *
 * `requestEvidenceDownloadUrl` has existed in the application layer since
 * Stage 8 and nothing exposed it, so the evidence both parties attach could
 * be uploaded and never read — cases were being decided on the written reason
 * while the photographs sat in object storage. The same shape of gap as the
 * credential viewer, found the same way: by building the screen that needed
 * it.
 *
 * Guarded on `dispute.manage`, which an adjudicator holds at PLATFORM and a
 * party holds at SELF. The URL is issued per read and the read is audited —
 * a dispute's evidence is the most sensitive thing this module holds, and a
 * permanent link would outlive any reason to hold it.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string; evidenceId: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: evidenceUrlSchema,
      permission: 'dispute.manage',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) =>
        requestEvidenceDownloadUrl({
          evidenceId: input.evidenceId,
          viewerId: session.userId,
        }),
    },
    params,
  );
}
