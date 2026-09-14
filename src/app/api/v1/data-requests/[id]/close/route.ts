import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { closeRequestSchema } from '@/modules/audit-compliance/presentation/consent-schemas';
import { closeRequest } from '@/modules/audit-compliance/application/data-subject';

/**
 * POST /api/v1/data-requests/:id/close — answer one.
 *
 * An outcome is required either way. A refusal is a lawful answer and has to
 * be recorded as carefully as a grant — more so, because it is the one
 * somebody appeals.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: closeRequestSchema,
      permission: 'audit.read',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        closeRequest({
          requestId: input.id,
          actorId: session.userId,
          status: input.status,
          outcome: input.outcome,
        }),
    },
    params,
  );
}
