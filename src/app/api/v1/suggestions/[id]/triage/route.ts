import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { triageSuggestionSchema } from '@/modules/suggestions/presentation/schemas';
import { triageSuggestion } from '@/modules/suggestions/application/suggestion';

/**
 * POST /api/v1/suggestions/:id/triage — move it along, or answer it.
 *
 * `DONE` and `DECLINED` need a written response; `TRIAGED` and `PLANNED` do
 * not. Moving something along a queue is housekeeping; telling somebody their
 * suggestion is finished with is an answer, and a declined suggestion with no
 * reason is how a pilot teaches people to stop bothering.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: triageSuggestionSchema,
      permission: 'suggestion.triage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        triageSuggestion({
          suggestionId: input.id,
          actorId: session.userId,
          status: input.status,
          response: input.response,
        }),
    },
    params,
  );
}
