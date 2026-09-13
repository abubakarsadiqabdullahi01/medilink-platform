import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { emptyQuerySchema } from '@/modules/suggestions/presentation/schemas';
import { suggestionsByArea } from '@/modules/suggestions/application/suggestion';

/**
 * GET /api/v1/suggestions/summary — how many, by area, and how many open.
 *
 * The single most useful view of a pilot log, and the reason the `area`
 * column exists. What a founder deciding what to fix next needs is the shape
 * of the complaints, not the complaints themselves: "eleven people have now
 * said the same thing about matching" is the finding.
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: emptyQuerySchema,
    permission: 'suggestion.triage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => ({ areas: await suggestionsByArea() }),
  });
}
