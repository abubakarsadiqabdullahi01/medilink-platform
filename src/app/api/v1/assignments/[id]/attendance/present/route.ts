import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { presentTokenSchema } from '@/modules/attendance/presentation/schemas';
import { presentCheckInToken } from '@/modules/attendance/application/attendance';

/**
 * POST /api/v1/assignments/:id/attendance/present — the practitioner presents
 * the code, typed or scanned.
 *
 * SELF-scoped: this is the practitioner's own act. Both a six-digit code and
 * a whole QR payload arrive here, because they are the same secret.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: presentTokenSchema,
      permission: 'attendance.record',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) =>
        presentCheckInToken({
          assignmentId: input.id,
          purpose: input.purpose,
          code: input.code,
          userId: session.userId,
          deviceLabel: input.deviceLabel,
        }),
    },
    params,
  );
}
