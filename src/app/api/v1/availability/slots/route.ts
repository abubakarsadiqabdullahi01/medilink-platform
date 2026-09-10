import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { addSlotSchema } from '@/modules/availability/presentation/schemas';
import { addSlot } from '@/modules/availability/application/availability';

/**
 * POST /api/v1/availability/slots — offer a window, either every week or
 * once.
 *
 * SELF-only, always: availability is a statement a practitioner makes about
 * themselves, and nobody else should be able to say they are free.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: addSlotSchema,
    permission: 'availability.write',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ input, session }) => addSlot({ ...input, userId: session.userId }),
    successStatus: 201,
  });
}
