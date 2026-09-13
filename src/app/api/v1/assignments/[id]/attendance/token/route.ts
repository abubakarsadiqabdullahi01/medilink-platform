import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { issueTokenSchema } from '@/modules/attendance/presentation/schemas';
import { issueCheckInToken } from '@/modules/attendance/application/attendance';

/**
 * POST /api/v1/assignments/:id/attendance/token — the facility issues the
 * short-lived secret, as a six-digit code and as a QR payload.
 *
 * FACILITY-scoped because the direction is the point: a code the practitioner
 * could generate themselves would prove only that they own a phone. The
 * plaintext is returned once here and never stored.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: issueTokenSchema,
      permission: 'attendance.record',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        issueCheckInToken({
          assignmentId: input.id,
          purpose: input.purpose,
          actorId: session.userId,
        }),
      successStatus: 201,
    },
    params,
  );
}
