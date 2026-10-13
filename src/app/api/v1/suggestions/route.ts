import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  listSuggestionsSchema,
  submitSuggestionSchema,
} from '@/modules/suggestions/presentation/schemas';
import {
  listSuggestions,
  submitSuggestion,
} from '@/modules/suggestions/application/suggestion';

/**
 * POST /api/v1/suggestions — step 9.5.
 *
 * A low bar on purpose. The cost of a thin suggestion is one row; the cost of
 * a form that argues with people is every suggestion they do not file.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: submitSuggestionSchema,
    permission: 'suggestion.submit',
    scope: (input, session) =>
      input.facilityId
        ? { type: 'FACILITY', id: input.facilityId }
        : { type: 'SELF', id: session.userId },
    action: async ({ input, session }) =>
      submitSuggestion({ userId: session.userId, area: input.area, body: input.body }),
    successStatus: 201,
  });
}

/** GET — the log, newest first, narrowable by status or area, and paged. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listSuggestionsSchema,
    permission: 'suggestion.triage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) => listSuggestions(input),
  });
}
