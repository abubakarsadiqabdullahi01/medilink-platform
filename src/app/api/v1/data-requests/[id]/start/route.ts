import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { startRequestSchema } from '@/modules/audit-compliance/presentation/consent-schemas';
import { startRequest } from '@/modules/audit-compliance/application/data-subject';

/**
 * POST /api/v1/data-requests/:id/start — somebody has picked this up.
 *
 * A work signal, not a legal one. The statutory month runs from the day the
 * request arrived and `dueBy` was fixed then; this only lets a colleague see
 * that the request is being handled rather than starting it again.
 *
 * Until this existed nothing in the product ever wrote `IN_PROGRESS`, so the
 * console's tab for it was permanently empty.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: startRequestSchema,
      permission: 'audit.read',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        startRequest({ requestId: input.id, actorId: session.userId }),
    },
    params,
  );
}
