import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { z } from 'zod';
import { requestPhotoDownloadUrl } from '@/modules/practitioners/application/profile';

/**
 * POST /api/v1/practitioners/me/photo-url — a signed Tigris GET URL for the
 * caller's own profile photograph.
 *
 * The counterpart to photo-upload-url, which shipped without it: the bytes
 * could be stored and never read back. POST rather than GET because the
 * signed URL is a credential of sorts and does not belong in a browser
 * history or a proxy log.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: z.object({}),
    permission: 'practitioner.profile.read',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ session }) => requestPhotoDownloadUrl(session.userId),
  });
}
