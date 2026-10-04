import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { listPractitioners } from '@/modules/practitioners/application/directory';

/**
 * GET /api/v1/practitioners — the directory an officer works from.
 *
 * `PLATFORM` only, and there is no SELF branch on purpose: a practitioner has
 * `/practitioners/me` and has no business enumerating anybody else.
 *
 * Paginated rather than whole. The pilot is small enough that it would not
 * matter today, which is exactly when the habit is cheap to establish.
 */
const listSchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  cursor: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listSchema,
    permission: 'practitioner.profile.read',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) =>
      listPractitioners({ search: input.search, limit: input.limit, cursor: input.cursor }),
  });
}
