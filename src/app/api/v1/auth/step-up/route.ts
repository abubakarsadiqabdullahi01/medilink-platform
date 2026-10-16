import { z } from 'zod';
import { fail, handleError, ok } from '@/lib/http/responses';
import { requestContextFrom, traceOf } from '@/lib/http/request-context';
import { withTrace } from '@/lib/trace';
import { HttpError } from '@/lib/http/errors';
import { requireSession, stepUpSession } from '@/modules/auth/application/session-service';

const schema = z.object({ password: z.string().min(1).max(200) });

/**
 * POST /api/v1/auth/step-up — step 4.8.
 *
 * Not a guarded route, and deliberately so: `handleGuardedRequest` requires a
 * permission and a scope, and this endpoint is how a caller *acquires* the
 * right to exercise one. Naming a permission here would be circular. It still
 * requires a usable session — a step-up with nothing to step up from is
 * nothing — and it is the only route in the application outside `auth` that
 * takes a password.
 */
export async function POST(request: Request) {
  const context = requestContextFrom(request);

  try {
    const session = await requireSession();
    const { password } = schema.parse(await request.json().catch(() => ({})));

    const result = await withTrace(traceOf(context), () =>
      stepUpSession({
        sessionId: session.sessionId,
        userId: session.userId,
        password,
        ipAddress: context.ipAddress,
      }),
    );

    // The timestamp, not the window: a client that wants to grey out a button
    // can ask the session endpoint, which already reports `stepUpFresh`.
    return ok({ stepUpAt: result.stepUpAt }, context);
  } catch (error) {
    if (error instanceof HttpError) return fail(error.code, error.message, context, error.status);
    return handleError(error, context);
  }
}
