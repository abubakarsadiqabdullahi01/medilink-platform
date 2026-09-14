import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { revokeGrantSchema } from '@/modules/auth/presentation/grant-schemas';
import { revokeGrant } from '@/modules/auth/application/grants';

/**
 * POST /api/v1/grants/:id/revoke — take access away.
 *
 * The row is kept and stamped rather than deleted, so the trail can still
 * answer when somebody had access and when it stopped.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: revokeGrantSchema,
      permission: 'role.grant',
      scope: (input) => ({ type: input.scopeType, id: input.scopeId }),
      action: async ({ input, session }) =>
        revokeGrant({ grantId: input.id, actorId: session.userId, reason: input.reason }),
    },
    params,
  );
}
