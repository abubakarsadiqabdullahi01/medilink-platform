import { requestContextFrom } from '@/lib/http/request-context';
import { fail, handleError, ok } from '@/lib/http/responses';
import { HttpError } from '@/lib/http/errors';
import { requireSession } from '@/modules/auth/application/session-service';
import { getReferenceData } from '@/modules/config/reference';

/**
 * GET /api/v1/reference — the controlled vocabularies.
 *
 * **Authenticated but not permission-guarded**, and that is a decision rather
 * than an omission. `handleGuardedRequest` requires a permission and a scope
 * because it protects somebody's records; this returns the list of Nigerian
 * states, the MDCN's professional categories and the credential types
 * compliance publishes. None of it is anybody's data, all of it is needed by
 * every form in the product, and inventing a permission that every role would
 * hold would be ceremony rather than a control — the same reasoning that
 * leaves the step-up endpoint unguarded.
 *
 * A session is still required. Not because the contents are sensitive, but
 * because an unauthenticated endpoint is a thing to be scraped, and there is
 * no reason to offer one.
 */
export async function GET(request: Request) {
  const context = requestContextFrom(request);

  try {
    await requireSession();
    return ok(await getReferenceData(), context);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.code, error.message, context, error.status);
    return handleError(error, context);
  }
}
