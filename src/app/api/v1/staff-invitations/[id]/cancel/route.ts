import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { cancelStaffInvitationSchema } from '@/modules/auth/presentation/staff-invitation-schemas';
import { cancelStaffInvitation } from '@/modules/auth/application/staff-invitations';

/**
 * POST /api/v1/staff-invitations/:id/cancel — withdraw an invitation nobody has answered.
 *
 * The facility is named and guarded, and the invitation must be that facility's: somebody
 * else's is "not found", not "forbidden", so identifiers reveal nothing across facilities.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: cancelStaffInvitationSchema,
      permission: 'role.grant',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input, session }) =>
        cancelStaffInvitation({
          invitationId: input.id,
          facilityId: input.facilityId,
          actorId: session.userId,
        }),
    },
    params,
  );
}
