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
import { attendanceForAssignments } from '@/modules/attendance/application/attendance';
import { earningsSummary } from '@/modules/billing-settlement/application/payout';

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
 *
 * Two sections were added for the overview that asks "what do I do now?": each confirmed
 * shift carries its attendance (so "check in" and "hours to submit" need no second request),
 * and `earnings` carries what is owed, on its way and paid. Both are the caller's own records
 * under the permission their own pages already require; no existing field changed.
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
    // The same permission the Earnings page's own endpoint asks for, at the same scope.
    const earningsAllowed = may('invoice.read');
    if (!profileAllowed && !availabilityAllowed && !documentsAllowed && !workAllowed) {
      throw new HttpError('forbidden', 'You do not have access to this.', 403);
    }

    const [profile, eligibility, availability, documents, invitations, assignments, earnings] = await Promise.all([
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
      earningsAllowed ? earningsSummary(userId) : undefined,
    ]);

    // Joined here, as `GET /assignments?include=attendance` does it: one query for the whole page
    // rather than one per shift. It is what lets the overview say "check in" and "submit your hours".
    const attendance = assignments
      ? await attendanceForAssignments(assignments.assignments.map((row) => row.id))
      : null;

    return ok(
      {
        ...(profile !== undefined ? { profile } : {}),
        ...(eligibility ? { eligibility } : {}),
        ...(availability ? { availability } : {}),
        ...(documents ? { submissions: documents.submissions } : {}),
        ...(invitations ? { invitations } : {}),
        ...(assignments
          ? {
              assignments: assignments.assignments.map((row) => ({
                ...row,
                attendance: attendance?.get(row.id) ?? null,
              })),
            }
          : {}),
        ...(earnings ? { earnings } : {}),
      },
      context,
    );
  } catch (error) {
    if (error instanceof HttpError) return fail(error.code, error.message, context, error.status);
    return handleError(error, context);
  }
}
