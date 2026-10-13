import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { manualAttendanceSchema } from '@/modules/attendance/presentation/schemas';
import { recordManualAttendance } from '@/modules/attendance/application/attendance';
import { getAssignmentInScope } from '@/modules/matching/application/assignment';

/**
 * POST /api/v1/assignments/:id/attendance/manual — step 7.3, the fallback for
 * a facility whose network failed.
 *
 * A supervisor records the times afterwards with a mandatory reason. The
 * record is marked MANUALLY_CORRECTED so nobody later mistakes it for a
 * token-backed check-in, and the events keep `occurredAt` and `recordedAt`
 * separately — which is the whole difference here.
 *
 * The facility in the body is what the guard authorises; the shift in the
 * path has to be that facility's, or one facility could write another's hours.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: manualAttendanceSchema,
      permission: 'attendance.record',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) => {
        await getAssignmentInScope({
          assignmentId: input.id,
          scopeType: 'FACILITY',
          scopeId: input.facilityId,
        });

        return recordManualAttendance({
          assignmentId: input.id,
          actorId: session.userId,
          checkedInAt: input.checkedInAt,
          checkedOutAt: input.checkedOutAt,
          breakMinutes: input.breakMinutes,
          reason: input.reason,
        });
      },
    },
    params,
  );
}
