import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { logger } from '../logger';
import type { Trace } from '../trace';

/**
 * Request and correlation identifiers. The request id identifies one HTTP
 * call; the correlation id follows a business action across modules, events
 * and worker runs, which is what makes an incident traceable.
 */
export interface RequestContext {
  requestId: string;
  correlationId: string;
  userId?: string;
  ipAddress?: string;
}

/**
 * The address the request came from, for the audit trail and the per-address limits.
 *
 * A header is only as good as who sets it. `X-Forwarded-For` is set by every proxy on the
 * way and by the caller too, so unless the edge overwrites it a caller can pick their own
 * address and with it their own rate limit (AUT-02). `CLIENT_IP_HEADER` names the one
 * header the deployment's edge sets and overwrites (`fly-client-ip`, `cf-connecting-ip`,
 * `x-real-ip`): when it is set that header is the only one read, and a request without it
 * has no address rather than whatever the caller wrote. `none`, or unset in local, reads the
 * first `X-Forwarded-For` entry, which is right only behind an edge that replaces it: staging
 * and production refuse to start until the deployer has chosen (see env-rules.ts).
 */
function clientAddress(headers: Headers): string | undefined {
  const named = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  // `none` is the deployer saying, on purpose, that the edge replaces X-Forwarded-For.
  const raw = named && named !== 'none' ? headers.get(named) : headers.get('x-forwarded-for');
  return raw?.split(',')[0]?.trim() || undefined;
}

/**
 * An identifier a caller supplied, if it is the kind a tracing tool produces.
 *
 * The correlation id is saved on every audit row and event, and a row in the trail is kept for
 * good. A header is the caller's to write, so taken as it came it would be a way to put an
 * address, a number or a page of text where nothing can remove it, or to forge a link to
 * somebody else's action. Letters, digits and `._-`, eight to sixty-four of them, covers a UUID,
 * a W3C trace id and the ids the common tools make; anything else is replaced with a fresh one.
 */
const SAFE_IDENTIFIER = /^[A-Za-z0-9._-]{8,64}$/;

function suppliedOrNew(value: string | null): string {
  return value !== null && SAFE_IDENTIFIER.test(value) ? value : randomUUID();
}

export function requestContextFrom(request: Request, userId?: string): RequestContext {
  const headers = request.headers;
  return {
    requestId: suppliedOrNew(headers.get('x-request-id')),
    correlationId: suppliedOrNew(headers.get('x-correlation-id')),
    userId,
    ipAddress: clientAddress(headers),
  };
}

/** The trace a request's work runs under, so what it writes can be tied back to it. */
export function traceOf(context: RequestContext): Trace {
  return { correlationId: context.correlationId, requestId: context.requestId };
}

export function contextLogger(context: RequestContext) {
  return logger.child({
    requestId: context.requestId,
    correlationId: context.correlationId,
    userId: context.userId,
  });
}
