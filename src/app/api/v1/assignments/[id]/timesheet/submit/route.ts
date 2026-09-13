import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { submitTimesheetSchema } from '@/modules/timesheets/presentation/schemas';
import { submitTimesheet } from '@/modules/timesheets/application/timesheet';

/**
 * POST /api/v1/assignments/:id/timesheet/submit — step 7.5, the practitioner
 * submits what the shift came to.
 *
 * The hours are recomputed at submission, so what is submitted is what
 * attendance currently says rather than a figure computed earlier and left
 * behind.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: submitTimesheetSchema,
      permission: 'timesheet.submit',
      scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
      action: async ({ input, session }) =>
        submitTimesheet({ assignmentId: input.id, userId: session.userId }),
    },
    params,
  );
}
