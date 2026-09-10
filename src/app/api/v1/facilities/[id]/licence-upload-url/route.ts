import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { licenceUploadUrlSchema } from '@/modules/facilities/presentation/schemas';
import { requestLicenceUploadUrl } from '@/modules/facilities/application/facility';

/**
 * POST /api/v1/facilities/:id/licence-upload-url — a signed PUT URL for the
 * facility's licence document, so the bytes never pass through the app.
 *
 * The returned objectKey is attached to the facility with a subsequent PATCH,
 * which is where the reference is confirmed to belong to this facility.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: licenceUploadUrlSchema,
      permission: 'facility.write',
      scope: (input) => ({ type: 'FACILITY', id: input.id }),
      action: async ({ input, session }) =>
        requestLicenceUploadUrl({
          facilityId: input.id,
          actorId: session.userId,
          filename: input.filename,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
        }),
    },
    params,
  );
}
