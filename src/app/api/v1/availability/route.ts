import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { availabilityQuerySchema } from '@/modules/availability/presentation/schemas';
import { getAvailability } from '@/modules/availability/application/availability';

/**
 * GET /api/v1/availability — the slots a practitioner offers and the periods
 * they are away.
 *
 * SELF for their own calendar, PLATFORM for operations working an unfilled
 * shift, following the same "caller states the scope" pattern as the audit
 * trail and the credential queue.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: availabilityQuerySchema,
    permission: 'availability.read',
    scope: (input, session) => ({
      type: input.scopeType,
      id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
    }),
    action: async ({ input, session }) => {
      const userId = input.scopeType === 'SELF' ? session.userId : input.scopeId;
      if (!userId) return { userId: null, slots: [], blocks: [] };
      return getAvailability(userId);
    },
  });
}
