import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { correctTimesheetSchema } from '@/modules/timesheets/presentation/schemas';
import { correctTimesheet } from '@/modules/timesheets/application/timesheet';

/**
 * POST /api/v1/assignments/:id/timesheet/correct — step 7.6.
 *
 * The previous state is written whole into a revision before anything moves,
 * with the actor and the reason. "No correction destroys the value it
 * replaces" is a gate condition, and a diff would only be readable against a
 * history nobody kept.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: correctTimesheetSchema,
      permission: 'timesheet.approve',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        correctTimesheet({
          assignmentId: input.id,
          facilityId: input.facilityId,
          actorId: session.userId,
          checkedInAt: input.checkedInAt,
          checkedOutAt: input.checkedOutAt,
          breakMinutes: input.breakMinutes,
          onCallMinutes: input.onCallMinutes,
          reason: input.reason,
        }),
    },
    params,
  );
}
