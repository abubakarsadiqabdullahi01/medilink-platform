import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { cancelAssignmentSchema } from '@/modules/matching/presentation/schemas';
import { cancelAssignment } from '@/modules/matching/application/assignment';

/**
 * POST /api/v1/assignments/:id/cancel — take a practitioner off a shift.
 *
 * A reason is required, and it goes into assignment_status_history alongside
 * the actor — step 6.6's "every change records actor and reason", enforced by
 * the columns rather than by remembering.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: cancelAssignmentSchema,
      permission: 'assignment.cancel',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        cancelAssignment({
          assignmentId: input.id,
          facilityId: input.facilityId,
          actorId: session.userId,
          reason: input.reason,
        }),
    },
    params,
  );
}
