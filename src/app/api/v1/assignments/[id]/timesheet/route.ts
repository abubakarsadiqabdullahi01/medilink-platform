import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { readTimesheetSchema } from '@/modules/timesheets/presentation/schemas';
import { getTimesheet, timesheetRevisions } from '@/modules/timesheets/application/timesheet';
import { getAssignmentInScope } from '@/modules/matching/application/assignment';

/**
 * GET /api/v1/assignments/:id/timesheet — the hours, and every value they
 * used to be.
 *
 * The revisions come back alongside because a timesheet read without its
 * history cannot answer the question a dispute asks.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: readTimesheetSchema,
      permission: 'service_request.read',
      scope: (input, session) => ({
        type: input.scopeType,
        id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
      }),
      // The scope above says what the caller may reach; this says whether the
      // shift in the path is inside it. Without the second question a
      // practitioner could name anybody's assignment id, declare their own
      // SELF scope, and be handed that person's hours and pay.
      action: async ({ input, session }) => {
        await getAssignmentInScope({
          assignmentId: input.id,
          scopeType: input.scopeType,
          scopeId: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
        });

        return {
          timesheet: await getTimesheet(input.id),
          revisions: await timesheetRevisions(input.id),
        };
      },
    },
    params,
  );
}
