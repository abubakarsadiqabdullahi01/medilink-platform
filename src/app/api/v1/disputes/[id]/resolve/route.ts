import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { resolveDisputeSchema } from '@/modules/disputes/presentation/schemas';
import { resolveDispute } from '@/modules/disputes/application/dispute';

/**
 * POST /api/v1/disputes/:id/resolve — upheld or dismissed, with a reason.
 *
 * Upheld sends the shift back to SUBMITTED to be decided again; dismissed
 * restores it to whatever it was when the case opened. Upholding does not
 * itself rewrite the hours — the facility corrects the timesheet through the
 * ordinary route, so the change lands in `timesheet_revisions` where somebody
 * can see it.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: resolveDisputeSchema,
      permission: 'dispute.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        resolveDispute({
          disputeId: input.id,
          actorId: session.userId,
          outcome: input.outcome,
          notes: input.notes,
        }),
    },
    params,
  );
}
