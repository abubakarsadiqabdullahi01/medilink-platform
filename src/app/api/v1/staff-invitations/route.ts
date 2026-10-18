import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  inviteStaffSchema,
  listStaffInvitationsSchema,
} from '@/modules/auth/presentation/staff-invitation-schemas';
import { inviteStaff, listStaffInvitations } from '@/modules/auth/application/staff-invitations';

/**
 * POST /api/v1/staff-invitations — invite somebody to work for a facility, by phone number.
 *
 * Scoped to the facility, behind `role.grant` and so behind the password re-entry that permission
 * carries: it is how a hospital decides who else may act for it. The number need not belong to an
 * account, and the answer is the same whether or not it does. The service checks that the caller
 * may give the role, that the facility is verified (unless the caller is Medilink), and the three
 * limits on sending.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: inviteStaffSchema,
    permission: 'role.grant',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    successStatus: 201,
    action: async ({ input, session }) =>
      inviteStaff({
        facilityId: input.facilityId,
        phone: input.phone,
        roleKey: input.roleKey,
        actorId: session.userId,
      }),
  });
}

/** GET — what this facility has sent, and what became of each. The number is masked. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listStaffInvitationsSchema,
    permission: 'role.grant',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ input }) => ({ invitations: await listStaffInvitations({ facilityId: input.facilityId }) }),
  });
}
