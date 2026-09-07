import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { fail, handleError, ok } from './responses';
import { contextLogger, requestContextFrom, type RequestContext } from './request-context';
import { AuthorizationError, requirePermission, type RequestedScope } from '../authz/guard';
import type { Permission } from '../authz/permissions';
import { AuthError } from '@/modules/auth/domain/errors';
import { requireSession, type CurrentSession } from '@/modules/auth/application/session-service';

/**
 * The plumbing every authenticated endpoint goes through: resolve the caller,
 * validate the input, then check the permission *and* the scope before the
 * action runs.
 *
 * Section 9.10 of the specification, and rule 1 of the README, say
 * authorisation is enforced by permission and scope together and never by role
 * alone. A helper is what makes that the path of least resistance — a route
 * that forgets the check has to go out of its way to do so, because the only
 * way to get the session is to ask for it here, and asking for it here means
 * naming a permission and a scope.
 *
 * It lives in lib rather than in a module because it is platform machinery:
 * authentication is not a peer module's business data, and every module from
 * Stage 5 onwards needs this same shape.
 */

export interface GuardedRequest<TInput> {
  input: TInput;
  context: RequestContext;
  session: CurrentSession;
}

export interface GuardOptions<TInput, TOutput> {
  /** Query string for reads, JSON body for writes. */
  source: 'query' | 'body';
  /**
   * Typed as parsing `unknown`, so TInput is the schema's *output*. A schema
   * using .default() or .refine() has a different input type, and inferring
   * from that would hand the action a value where the defaults are still
   * optional — defeating the point of applying them.
   */
  schema: ZodType<TInput, ZodTypeDef, unknown>;
  permission: Permission;
  /**
   * The scope of the record being touched, derived from the request.
   *
   * Deriving it rather than assuming one is the whole point. "Does this user
   * hold audit.read" is not a question that can be answered safely; "does this
   * user hold audit.read over facility X" is. A handler that cannot say which
   * scope it is touching cannot be authorised, and this signature makes that
   * impossible to skip.
   */
  scope: (input: TInput, session: CurrentSession) => RequestedScope;
  action: (request: GuardedRequest<TInput>) => Promise<TOutput>;
  successStatus?: number;
}

function inputFrom(request: Request, source: 'query' | 'body'): Promise<unknown> {
  if (source === 'query') {
    return Promise.resolve(Object.fromEntries(new URL(request.url).searchParams));
  }
  return request.json().catch(() => ({}));
}

export async function handleGuardedRequest<TInput, TOutput>(
  request: Request,
  options: GuardOptions<TInput, TOutput>,
) {
  let context = requestContextFrom(request);

  try {
    // 401 before 403: an anonymous caller is told to sign in, not that they
    // lack a permission they could never hold.
    const session = await requireSession();
    context = { ...context, userId: session.userId };

    const input = options.schema.parse(await inputFrom(request, options.source));

    await requirePermission(session.userId, options.permission, options.scope(input, session));

    return ok(await options.action({ input, context, session }), context, options.successStatus ?? 200);
  } catch (error) {
    if (error instanceof AuthError) {
      return fail(error.code, error.message, context, error.status);
    }

    // A refusal is the guard working, not the system failing. It is worth a
    // line — a burst of them is an attack — but logging it at error level
    // would fill the error tracker with correct behaviour, and a tracker full
    // of noise is one nobody reads.
    if (error instanceof AuthorizationError) {
      contextLogger(context).warn('permission refused', {
        permission: options.permission,
        reason: error.message,
      });
    } else if (!(error instanceof ZodError)) {
      contextLogger(context).error('guarded request failed', {
        permission: options.permission,
        error: String(error),
      });
    }
    // AuthorizationError becomes a 403 here, with no detail about what would
    // have been returned: a distinguishable 403 and 404 is a directory.
    return handleError(error, context);
  }
}
