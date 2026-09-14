import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { inviteSchema } from '@/modules/matching/presentation/schemas';
import { invitePractitioners } from '@/modules/matching/application/assignment';

/**
 * POST /api/v1/service-requests/:id/invite — invite the practitioners the
 * facility chose from a match run.
 *
 * Chosen, not invited automatically: step 9.4 requires every match to be
 * hand-reviewed for the first fifty engagements, so the platform ranks and a
 * person decides.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: inviteSchema,
      permission: 'assignment.confirm',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        invitePractitioners({
          requestId: input.id,
          facilityId: input.facilityId,
          userIds: input.userIds,
          matchRunId: input.matchRunId,
          expiresInHours: input.expiresInHours,
          actorId: session.userId,
        }),
      successStatus: 201,
    },
    params,
  );
}
