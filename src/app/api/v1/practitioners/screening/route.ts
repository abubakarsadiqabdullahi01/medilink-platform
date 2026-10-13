import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  clearScreeningSchema,
  screeningQuerySchema,
} from '@/modules/practitioners/presentation/schemas';
import {
  clearScreeningFlag,
  getScreeningForReview,
} from '@/modules/practitioners/application/screening';

/**
 * GET /api/v1/practitioners/screening?userId= — the result and the entry it
 * matched (step 5.6).
 *
 * POST — clear a flag as a false positive. `clearScreeningFlag` has existed
 * since 5.6 with nothing calling it, which left every flagged practitioner
 * blocked for good: the one queue in the product nobody could work.
 *
 * Both on `credential.review` at PLATFORM, beside identity and registration,
 * because answering a flag is the same job as checking a licence.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: screeningQuerySchema,
    permission: 'credential.review',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) => getScreeningForReview(input.userId),
  });
}

export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: clearScreeningSchema,
    permission: 'credential.review',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) =>
      clearScreeningFlag({ userId: input.userId, actorId: session.userId, notes: input.notes }),
  });
}
