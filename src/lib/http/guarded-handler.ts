import { ZodError, type ZodType, type ZodTypeDef } from 'zod';
import { fail, handleError, ok } from './responses';
import { contextLogger, requestContextFrom, traceOf, type RequestContext } from './request-context';
import { withTrace } from '../trace';
import { AuthorizationError, requirePermission, type RequestedScope } from '../authz/guard';
import { requiresStepUp, type Permission } from '../authz/permissions';
import { HttpError } from './errors';
import { requireFreshStepUp } from './session-handler';
import { logger } from '../logger';
import { env } from '../env';
import { recordRequest, routeKey, serverTimingHeader, withTiming } from './timing';
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

function mergeRouteParams(raw: unknown, routeParams?: Record<string, string>): unknown {
  if (!routeParams) return raw;
  const base = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { ...base, ...routeParams };
}

/**
 * Opens the request's trace, so every audit row and event the action writes carries the request's
 * correlation id (AUD-13), and runs the guard inside it.
 */
async function handle<TInput, TOutput>(
  request: Request,
  options: GuardOptions<TInput, TOutput>,
  routeParams?: Record<string, string>,
) {
  const context = requestContextFrom(request);
  return withTrace(traceOf(context), () => guard(request, options, context, routeParams));
}

async function guard<TInput, TOutput>(
  request: Request,
  options: GuardOptions<TInput, TOutput>,
  initial: RequestContext,
  /**
   * A dynamic segment's values, e.g. Next.js's `{ params: { id } }` for a
   * route under `[id]/`. Merged into the parsed input after the query/body,
   * so the URL always wins over a same-named field — the path is
   * authoritative for identity, not something a caller can override.
   */
  routeParams?: Record<string, string>,
) {
  let context = initial;

  try {
    // 401 before 403: an anonymous caller is told to sign in, not that they
    // lack a permission they could never hold.
    const session = await requireSession();
    context = { ...context, userId: session.userId };

    const raw = await inputFrom(request, options.source);
    const input = options.schema.parse(mergeRouteParams(raw, routeParams));

    // Step 4.8, checked here rather than per route: the requirement is a
    // property of the permission, so a route that names one cannot forget it.
    //
    // Before the permission check, not after. After it, a `step_up_required`
    // response would tell the caller they hold the permission — which is
    // precisely what the 403 below refuses to disclose. Before it, everybody
    // asking gets the same answer whatever they hold.
    if (requiresStepUp(options.permission)) requireFreshStepUp(session);

    await requirePermission(session.userId, options.permission, options.scope(input, session));

    return ok(await options.action({ input, context, session }), context, options.successStatus ?? 200);
  } catch (error) {
    if (error instanceof HttpError) {
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

/**
 * Every guarded endpoint, timed.
 *
 * Wraps the guard above without changing what it does, and records how long it
 * took, how much of that was the database, and how big the answer was — see
 * ./timing.ts. A `Server-Timing` header goes on every response so the cost of a
 * request is visible in the browser's own network panel, and anything slower
 * than `SLOW_REQUEST_MS` is logged as a warning with its query count, which is
 * usually the whole diagnosis: a slow route with 200 queries is an N+1, one
 * with 3 queries and 2 seconds is a bad plan.
 */
export async function handleGuardedRequest<TInput, TOutput>(
  request: Request,
  options: GuardOptions<TInput, TOutput>,
  routeParams?: Record<string, string>,
) {
  return timed(request, () => handle(request, options, routeParams));
}

/**
 * Times any route handler the way `handleGuardedRequest` times its own.
 *
 * For the routes that answer to more than one permission and so cannot use the
 * guard's one-permission-one-scope shape (the two dashboards): they still need
 * to appear in the performance report and carry `Server-Timing`, and as the
 * aggregation routes they are the ones most likely to need it.
 */
export async function timed(request: Request, run: () => Promise<Response>): Promise<Response> {
  const started = performance.now();
  const { result: response, timing } = await withTiming(run);
  const totalMs = performance.now() - started;

  response.headers.set('Server-Timing', serverTimingHeader(totalMs, timing));

  const route = routeKey(request.method, new URL(request.url).pathname);
  // A clone, so reading the body to size it leaves the response intact.
  const bytes = (await response.clone().arrayBuffer()).byteLength;
  const slow = recordRequest({
    route,
    status: response.status,
    totalMs,
    timing,
    bytes,
    slowMs: env.SLOW_REQUEST_MS,
  });

  if (slow) {
    logger.warn('slow request', {
      requestId: response.headers.get('x-request-id') ?? undefined,
      route,
      status: response.status,
      durationMs: Math.round(totalMs),
      dbMs: Math.round(timing.dbMs),
      queries: timing.queries,
      bytes,
    });
  }
  return response;
}
