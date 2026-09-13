import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { reviewTimesheetSchema } from '@/modules/timesheets/presentation/schemas';
import { reviewTimesheet } from '@/modules/timesheets/application/timesheet';

/**
 * POST /api/v1/assignments/:id/timesheet/review — step 7.5, the facility
 * approves or rejects.
 *
 * Approval is what sets the assignment to COMPLETED, a state that has been in
 * the enum since Stage 6 with nothing reaching it, and the thing that ends
 * cold start for the reliability score. A rejection needs a reason, or the
 * practitioner has nothing to act on.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: reviewTimesheetSchema,
      permission: 'timesheet.approve',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        reviewTimesheet({
          assignmentId: input.id,
          facilityId: input.facilityId,
          actorId: session.userId,
          decision: input.decision,
          reviewNotes: input.reviewNotes,
        }),
    },
    params,
  );
}
