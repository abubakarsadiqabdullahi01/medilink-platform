import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { confirmSchema } from '@/modules/matching/presentation/schemas';
import { confirmAssignment } from '@/modules/matching/application/assignment';

/**
 * POST /api/v1/service-requests/:id/confirm — put a practitioner on the shift.
 *
 * The confirmation serialises on the practitioner, so two overlapping
 * confirmations run at the same moment produce exactly one assignment — step
 * 6.7's requirement that overlaps are prevented rather than warned about.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: confirmSchema,
      permission: 'assignment.confirm',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        confirmAssignment({
          requestId: input.id,
          facilityId: input.facilityId,
          userId: input.userId,
          actorId: session.userId,
        }),
      successStatus: 201,
    },
    params,
  );
}
