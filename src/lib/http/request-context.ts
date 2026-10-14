import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { logger } from '../logger';

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

export function requestContextFrom(request: Request, userId?: string): RequestContext {
  const headers = request.headers;
  return {
    requestId: headers.get('x-request-id') ?? randomUUID(),
    correlationId: headers.get('x-correlation-id') ?? randomUUID(),
    userId,
    ipAddress: clientAddress(headers),
  };
}

export function contextLogger(context: RequestContext) {
  return logger.child({
    requestId: context.requestId,
    correlationId: context.correlationId,
    userId: context.userId,
  });
}
