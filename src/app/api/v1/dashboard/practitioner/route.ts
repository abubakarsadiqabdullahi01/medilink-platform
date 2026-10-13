import { requestContextFrom } from '@/lib/http/request-context';
import { fail, handleError, ok } from '@/lib/http/responses';
import { HttpError } from '@/lib/http/errors';
import { timed } from '@/lib/http/guarded-handler';
import { isAuthorized, loadGrants } from '@/lib/authz/guard';
import type { Permission } from '@/lib/authz/permissions';
import { requireSession } from '@/modules/auth/application/session-service';
import { getOwnProfile } from '@/modules/practitioners/application/profile';
import { getEligibility } from '@/modules/practitioners/application/eligibility';
import { getAvailability } from '@/modules/availability/application/availability';
import { listSubmissions } from '@/modules/credentials/application/submission';
import { listAssignments, listInvitationsFor } from '@/modules/matching/application/assignment';

/**
 * GET /api/v1/dashboard/practitioner — everything the overview draws, in one
 * request.
 *
 * The overview used to assemble itself from six: the profile, eligibility,
 * availability, documents, offers and upcoming shifts. Each is the caller's own
 * data and each already has an endpoint with its own permission, so this holds
 * the same line: a section is returned only if the caller holds that section's
 * permission for their own record, and omitted otherwise (the console then
 * asks the section's own endpoint, which refuses properly). Somebody who holds
 * none of them gets a 403 rather than an empty overview that reads as "nothing
 * to do".
 *
 * `profile` is null, not an error, for somebody who has not created one: that
 * is the normal state of a newcomer.
 */
export async function GET(request: Request) {
  return timed(request, () => overview(request));
}

async function overview(request: Request): Promise<Response> {
  const context = requestContextFrom(request);
  try {
    const session = await requireSession();
    const userId = session.userId;
    const grants = await loadGrants(userId);
    const may = (permission: Permission) =>
      isAuthorized(grants, permission, { type: 'SELF', id: userId }, userId);

    const profileAllowed = may('practitioner.profile.read');
    const availabilityAllowed = may('availability.read');
    const documentsAllowed = may('credential.document.read');
    const workAllowed = may('service_request.read');
    if (!profileAllowed && !availabilityAllowed && !documentsAllowed && !workAllowed) {
      throw new HttpError('forbidden', 'You do not have access to this.', 403);
    }

    const [profile, eligibility, availability, documents, invitations, assignments] = await Promise.all([
      profileAllowed
        ? getOwnProfile(userId).catch((error: unknown) => {
            if (error instanceof HttpError && error.status === 404) return null;
            throw error;
          })
        : undefined,
      profileAllowed ? getEligibility(userId) : undefined,
      availabilityAllowed ? getAvailability(userId) : undefined,
      documentsAllowed ? listSubmissions({ scopeType: 'SELF', scopeId: userId, limit: 50 }) : undefined,
      workAllowed ? listInvitationsFor(userId) : undefined,
      workAllowed
        ? listAssignments({ scopeType: 'SELF', scopeId: userId, status: 'CONFIRMED', limit: 200 })
        : undefined,
    ]);

    return ok(
      {
        ...(profile !== undefined ? { profile } : {}),
        ...(eligibility ? { eligibility } : {}),
        ...(availability ? { availability } : {}),
        ...(documents ? { submissions: documents.submissions } : {}),
        ...(invitations ? { invitations } : {}),
        ...(assignments ? { assignments: assignments.assignments } : {}),
      },
      context,
    );
  } catch (error) {
    if (error instanceof HttpError) return fail(error.code, error.message, context, error.status);
    return handleError(error, context);
  }
}
