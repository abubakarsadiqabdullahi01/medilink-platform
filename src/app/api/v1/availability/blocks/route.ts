import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { addBlockSchema } from '@/modules/availability/presentation/schemas';
import { addBlock } from '@/modules/availability/application/availability';

/**
 * POST /api/v1/availability/blocks — a period away.
 *
 * A block beats an offered slot: "I work Mondays" and "I am away this Monday"
 * is not a contradiction, and the second is the more specific statement.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: addBlockSchema,
    permission: 'availability.write',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    action: async ({ input, session }) => addBlock({ ...input, userId: session.userId }),
    successStatus: 201,
  });
}
