import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { recordFaultSchema } from '@/modules/cancellations-sanctions/presentation/schemas';
import { recordFault } from '@/modules/cancellations-sanctions/application/fault';

/**
 * POST /api/v1/assignments/:id/fault — step 7.7. A person decides.
 *
 * PLATFORM scope, not the facility's: a facility deciding whether its own
 * practitioner was at fault for a shift that facility failed to open is not a
 * finding anyone should rely on.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: recordFaultSchema,
      permission: 'sanction.apply',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        recordFault({
          assignmentId: input.id,
          actorId: session.userId,
          fault: input.fault,
          reason: input.reason,
        }),
    },
    params,
  );
}
