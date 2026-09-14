import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { verifyFacilitySchema } from '@/modules/facilities/presentation/schemas';
import { verifyFacility } from '@/modules/facilities/application/facility';

/**
 * POST /api/v1/facilities/:id/verify — approve or reject a facility.
 *
 * PLATFORM-scoped only: there is no FACILITY-scoped variant, because a
 * facility verifying itself is the one thing this endpoint exists to prevent.
 * verifyFacility refuses a representative acting on their own facility even
 * if they somehow hold both grants.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: verifyFacilitySchema,
      permission: 'facility.verify',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        verifyFacility({
          facilityId: input.id,
          verifierId: session.userId,
          decision: input.decision,
          reviewNotes: input.reviewNotes,
        }),
    },
    params,
  );
}
