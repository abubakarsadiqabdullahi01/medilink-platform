import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { decideExcusalSchema } from '@/modules/cancellations-sanctions/presentation/schemas';
import { decideExcusal } from '@/modules/cancellations-sanctions/application/excusal';

/**
 * POST /api/v1/excusals/:id/decide — an officer grants or refuses.
 *
 * Granting closes any open fault determination as NEITHER, which is what "a
 * granted excusal carries no penalty" means in the data: the assignment never
 * reaches NO_SHOW, so it never enters the no-show term of the reliability
 * ratio. Refusing decides nothing about fault; that finding is still to make.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: decideExcusalSchema,
      permission: 'sanction.apply',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        decideExcusal({
          excusalId: input.id,
          actorId: session.userId,
          decision: input.decision,
          notes: input.notes,
        }),
    },
    params,
  );
}
