import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { issueTokenSchema } from '@/modules/attendance/presentation/schemas';
import { issueCheckInToken } from '@/modules/attendance/application/attendance';
import { getAssignmentInScope } from '@/modules/matching/application/assignment';

/**
 * POST /api/v1/assignments/:id/attendance/token — the facility issues the
 * short-lived secret, as a six-digit code and as a QR payload.
 *
 * FACILITY-scoped because the direction is the point: a code the practitioner
 * could generate themselves would prove only that they own a phone. The
 * plaintext is returned once here and never stored.
 *
 * The guard proves the caller acts for `facilityId`; nothing in it proves the
 * shift in the path is that facility's, so a scheduler could issue a code for
 * another facility's shift. `getAssignmentInScope` asks about the right record.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: issueTokenSchema,
      permission: 'attendance.record',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) => {
        await getAssignmentInScope({
          assignmentId: input.id,
          scopeType: 'FACILITY',
          scopeId: input.facilityId,
        });

        return issueCheckInToken({
          assignmentId: input.id,
          purpose: input.purpose,
          actorId: session.userId,
        });
      },
      successStatus: 201,
    },
    params,
  );
}
