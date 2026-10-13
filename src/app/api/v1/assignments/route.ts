import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { listAssignmentsSchema } from '@/modules/matching/presentation/schemas';
import { listAssignments } from '@/modules/matching/application/assignment';
import { attendanceForAssignments } from '@/modules/attendance/application/attendance';
import { timesheetsForAssignments } from '@/modules/timesheets/application/timesheet';

/**
 * GET /api/v1/assignments — a practitioner's own schedule, or a facility's.
 *
 * This is step 6.7's schedule list; the conflict detection that keeps it
 * consistent lives on the confirmation path.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listAssignmentsSchema,
    permission: 'service_request.read',
    scope: (input, session) => ({
      type: input.scopeType,
      id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
    }),
    action: async ({ input, session }) => {
      const scopeId = input.scopeType === 'SELF' ? session.userId : input.scopeId;
      if (!scopeId) return { assignments: [], nextCursor: null };
      const page = await listAssignments({
        scopeType: input.scopeType,
        scopeId,
        status: input.status,
        serviceRequestId: input.serviceRequestId,
        search: input.search,
        from: input.from,
        to: input.to,
        limit: input.limit,
        cursor: input.cursor,
      });

      // Joined here rather than in matching, which does not read attendance or
      // timesheets: each is one query for the whole page, not one per row.
      const ids = page.assignments.map((row) => row.id);
      const [attendance, sheets] = await Promise.all([
        input.include.has('attendance') ? attendanceForAssignments(ids) : null,
        input.include.has('timesheet') ? timesheetsForAssignments(ids) : null,
      ]);
      if (!attendance && !sheets) return page;
      return {
        ...page,
        assignments: page.assignments.map((row) => ({
          ...row,
          ...(attendance ? { attendance: attendance.get(row.id) ?? null } : {}),
          ...(sheets ? { sheet: sheets.get(row.id) ?? null } : {}),
        })),
      };
    },
  });
}
