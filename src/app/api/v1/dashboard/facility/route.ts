import { z } from 'zod';
import { timed } from '@/lib/http/guarded-handler';
import { requestContextFrom } from '@/lib/http/request-context';
import { fail, handleError, ok } from '@/lib/http/responses';
import { HttpError } from '@/lib/http/errors';
import { isAuthorized, loadGrants, type Grant } from '@/lib/authz/guard';
import { requireSession } from '@/modules/auth/application/session-service';
import { facilitySummary } from '@/modules/audit-compliance/application/facility-summary';
import { PERMISSIONS, type Permission } from '@/lib/authz/permissions';

const schema = z.object({ facilityId: z.string().uuid() });

/** What each section of the summary needs, each checked at THIS facility. */
const SECTIONS: Permission[] = [
  'service_request.read',
  'attendance.record',
  'timesheet.approve',
  'invoice.read',
];

/**
 * GET /api/v1/dashboard/facility?facilityId= — the numbers on a hospital's
 * dashboard, in one request.
 *
 * Each section is computed only if the caller holds its permission *at the
 * facility asked about* (or at PLATFORM). Somebody with grants at two hospitals
 * asking about one they do not belong to holds nothing there, so they get a 403
 * and not the other hospital's figures.
 */
export async function GET(request: Request) {
  return timed(request, () => summarise(request));
}

async function summarise(request: Request): Promise<Response> {
  const context = requestContextFrom(request);
  try {
    const session = await requireSession();
    const { facilityId } = schema.parse(Object.fromEntries(new URL(request.url).searchParams));

    const grants: Grant[] = await loadGrants(session.userId);
    const held = new Set<string>(
      SECTIONS.filter(
        (permission) =>
          permission in PERMISSIONS &&
          isAuthorized(grants, permission, { type: 'FACILITY', id: facilityId }, session.userId),
      ),
    );
    if (held.size === 0) throw new HttpError('forbidden', 'You do not have access to this facility.', 403);

    return ok(await facilitySummary(facilityId, held), context);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.code, error.message, context, error.status);
    return handleError(error, context);
  }
}
