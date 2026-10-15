import { requestContextFrom, traceOf } from '@/lib/http/request-context';
import { withTrace } from '@/lib/trace';
import { fail, handleError, ok } from '@/lib/http/responses';
import { HttpError } from '@/lib/http/errors';
import { prisma } from '@/lib/db';
import { requireSession } from '@/modules/auth/application/session-service';
import { createFacility } from '@/modules/facilities/application/facility';
import { registerFacilitySchema } from '@/modules/facilities/presentation/schemas';

/**
 * POST /api/v1/facilities/register — a hospital signs itself up.
 *
 * **Authenticated but not permission-guarded**, and that is the point: a
 * hospital that has never used Medilink holds no grant over anything, so a
 * permission check could only ever refuse them. Until now the only way onto
 * the platform was for operations to create the record by hand, which is
 * defensible for a pilot and a bottleneck immediately after one.
 *
 * What makes it safe is the gate that already existed rather than anything
 * new here. A facility is created `PENDING` and **a pending facility cannot
 * publish a shift**; compliance still verifies every one against its registration
 * reference and its licence before it can do anything at all. Self-service
 * moves who types the details, not who decides.
 *
 * `createFacility` grants the registrant `facility_owner` over what they
 * created, so they can add their own staff without waiting for anybody.
 */
export async function POST(request: Request) {
  const context = requestContextFrom(request);

  try {
    const session = await requireSession();
    const input = registerFacilitySchema.parse(await request.json());

    // One at a time. Somebody who has registered a facility and is waiting on
    // verification has no reason to register another, and this is what stops
    // a signed-in account filling the compliance queue with them.
    const pending = await prisma.facility.count({
      where: { representativeUserId: session.userId, status: 'PENDING', deletedAt: null },
    });
    if (pending > 0) {
      throw new HttpError(
        'registration_pending',
        'You already have a facility waiting to be verified. Compliance will be in touch about that one first.',
        409,
      );
    }

    const facility = await withTrace(traceOf(context), () =>
      createFacility({
        ...input,
        // The registrant is both the representative and the actor: they are
        // doing this for themselves, which is exactly what distinguishes it
        // from operations onboarding somebody.
        representativeUserId: session.userId,
        actorId: session.userId,
      }),
    );

    return ok(facility, context, 201);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.code, error.message, context, error.status);
    return handleError(error, context);
  }
}
