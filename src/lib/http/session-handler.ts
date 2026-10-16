import { fail, handleError, ok } from './responses';
import { requestContextFrom, traceOf, type RequestContext } from './request-context';
import { withTrace } from '../trace';
import { HttpError } from './errors';
import { requireSession, type CurrentSession } from '@/modules/auth/application/session-service';

/**
 * Refuses a session that has not confirmed its password within the step-up window
 * (step 4.8). For an endpoint that releases a great deal at once, or moves money, and
 * so should not be answered to a session cookie alone: a cookie left on a shared
 * phone, or taken from a stolen one, is not the password.
 *
 * `handleGuardedRequest` applies this itself for the permissions that require it. A
 * session-only route, which has no permission to key it on, calls it by name.
 */
export function requireFreshStepUp(session: CurrentSession): void {
  if (!session.stepUpFresh) {
    throw new HttpError('step_up_required', 'Confirm your password to continue.', 401);
  }
}

/**
 * The plumbing for an endpoint that any signed-in person may call, about
 * themselves and nobody else.
 *
 * `handleGuardedRequest` is for everything that touches a record a permission and
 * a scope decide. This is the other, narrow case, like `auth/session` and a
 * person's own inbox: no permission, because the only data it can reach is the
 * caller's own, and that is by construction. The action receives the session and
 * nothing in the request can say whose data it is: the owner is `session.userId`.
 * An endpoint that takes an id from the request does not belong here.
 */
export async function handleSessionRequest<T>(
  request: Request,
  action: (session: CurrentSession, context: RequestContext) => Promise<T>,
  successStatus = 200,
) {
  const context = requestContextFrom(request);
  return withTrace(traceOf(context), async () => {
    try {
      const session = await requireSession();
      return ok(await action(session, context), context, successStatus);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.code, error.message, context, error.status);
      return handleError(error, context);
    }
  });
}
