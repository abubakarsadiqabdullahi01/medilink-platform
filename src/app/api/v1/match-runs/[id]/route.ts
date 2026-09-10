import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { readMatchRunSchema } from '@/modules/matching/presentation/schemas';
import { getMatchRun } from '@/modules/matching/application/match';
import { HttpError } from '@/lib/http/errors';

/**
 * GET /api/v1/match-runs/:id — a past run, with every candidate's factors and
 * every excluded candidate's reasons.
 *
 * This is where step 6.3's gate evidence comes from: "the explainability
 * output for one real match — every factor and its contribution". The weights
 * in force at the time are stored on the run, so a ranking made under an older
 * set can still be read.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: readMatchRunSchema,
      permission: 'service_request.read',
      scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
      action: async ({ input }) => {
        const run = await getMatchRun({ matchRunId: input.id, facilityId: input.facilityId });
        // A run belonging to another facility is absent, not forbidden — the
        // caller already proved they may read this facility's runs.
        if (!run) throw new HttpError('match_run_not_found', 'That match run does not exist.', 404);
        return run;
      },
    },
    params,
  );
}
