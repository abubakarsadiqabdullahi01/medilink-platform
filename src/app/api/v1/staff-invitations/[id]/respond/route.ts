import { handleSessionRequest } from '@/lib/http/session-handler';
import { respondStaffInvitationSchema } from '@/modules/auth/presentation/staff-invitation-schemas';
import { respondToStaffInvitation } from '@/modules/auth/application/staff-invitations';

/**
 * POST /api/v1/staff-invitations/:id/respond — accept or decline.
 *
 * A session-only route that takes an identifier, which that wrapper's notes say not to do, because
 * the one person it exists for holds no permission to guard it with: somebody invited to their
 * first facility has no role yet. The owner is folded into the lookup instead. The invitation must
 * be for the caller's own verified number or it is "not found", the same words as for one that
 * never existed, and nothing in the request says whose number it is.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleSessionRequest(request, async (session) => {
    const body = respondStaffInvitationSchema.parse({
      ...(await request.json().catch(() => ({}))),
      id: params.id,
    });
    return respondToStaffInvitation({
      invitationId: body.id,
      userId: session.userId,
      decision: body.decision,
    });
  });
}
