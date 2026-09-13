import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { readTimesheetSchema } from '@/modules/timesheets/presentation/schemas';
import { getTimesheet, timesheetRevisions } from '@/modules/timesheets/application/timesheet';

/**
 * GET /api/v1/assignments/:id/timesheet — the hours, and every value they
 * used to be.
 *
 * The revisions come back alongside because a timesheet read without its
 * history cannot answer the question a dispute asks.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
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
      action: async ({ input }) => ({
        timesheet: await getTimesheet(input.id),
        revisions: await timesheetRevisions(input.id),
      }),
    },
    params,
  );
}
