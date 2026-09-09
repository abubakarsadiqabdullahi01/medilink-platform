import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { requestPhotoUploadUrlSchema } from '@/modules/practitioners/presentation/schemas';
import { requestPhotoUploadUrl } from '@/modules/practitioners/application/profile';

/**
 * POST /api/v1/practitioners/me/photo-upload-url — a signed Tigris PUT URL
 * for the caller's own profile photo. Bytes never pass through the app; the
 * client uploads directly, then references the returned objectKey when
 * creating or updating the profile.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: requestPhotoUploadUrlSchema,
    permission: 'practitioner.profile.write',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ input, session }) => requestPhotoUploadUrl({ ...input, userId: session.userId }),
  });
}
