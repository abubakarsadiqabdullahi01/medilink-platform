import { timed } from '@/lib/http/guarded-handler';
import { requestContextFrom } from '@/lib/http/request-context';
import { fail, handleError, ok } from '@/lib/http/responses';
import { HttpError } from '@/lib/http/errors';
import { loadGrants } from '@/lib/authz/guard';
import { requireSession } from '@/modules/auth/application/session-service';
import { platformSummary } from '@/modules/audit-compliance/application/platform-summary';

/**
 * GET /api/v1/dashboard/platform — the numbers on the operations dashboard, in
 * one request.
 *
 * Not behind `handleGuardedRequest`, because that asks for one permission at
 * one scope and this answers a different question: *which of these sections may
 * this person see?* Each section is computed only when the caller holds the
 * permission its queue requires at PLATFORM scope — the same permission and
 * scope the queue's own endpoint checks — so a summary can never show a count
 * for a queue the caller could not open. Somebody who holds none of them gets a
 * 403, not an empty page that reads as "nothing is waiting".
 *
 * Counts and dates only; see platform-summary.ts for why this reads across
 * modules' tables.
 */
export async function GET(request: Request) {
  return timed(request, () => summarise(request));
}

async function summarise(request: Request): Promise<Response> {
  const context = requestContextFrom(request);
  try {
    const session = await requireSession();
    const held = new Set(
      (await loadGrants(session.userId))
        .filter((grant) => grant.scopeType === 'PLATFORM')
        .map((grant) => grant.permission),
    );

    const summary = await platformSummary(held);
    const anything =
      Object.keys(summary.queues).length > 0 ||
      summary.growth.length > 0 ||
      summary.recent.length > 0 ||
      held.has('audit.read') ||
      held.has('facility.read') ||
      held.has('practitioner.profile.read');
    if (!anything) throw new HttpError('forbidden', 'You do not have access to this.', 403);

    return ok(summary, context);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.code, error.message, context, error.status);
    return handleError(error, context);
  }
}
