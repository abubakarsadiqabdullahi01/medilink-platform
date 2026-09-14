import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { readAttendanceSchema } from '@/modules/attendance/presentation/schemas';
import { getAttendance, listCheckInEvents } from '@/modules/attendance/application/attendance';

/**
 * GET /api/v1/assignments/:id/attendance — the record and how it got there.
 *
 * The events are the point: the record holds the current state, and the
 * append-only log holds every check-in attempt, its method, and the reason
 * when it was manual. That log is what a dispute months later actually reads.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: readAttendanceSchema,
      permission: 'service_request.read',
      scope: (input, session) => ({
        type: input.scopeType,
        id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
      }),
      action: async ({ input }) => ({
        attendance: await getAttendance(input.id),
        events: await listCheckInEvents(input.id),
      }),
    },
    params,
  );
}
