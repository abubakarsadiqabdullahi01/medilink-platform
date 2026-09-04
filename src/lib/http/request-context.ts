import { randomUUID } from 'node:crypto';
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

export function requestContextFrom(request: Request, userId?: string): RequestContext {
  const headers = request.headers;
  return {
    requestId: headers.get('x-request-id') ?? randomUUID(),
    correlationId: headers.get('x-correlation-id') ?? randomUUID(),
    userId,
    ipAddress: headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
  };
}

export function contextLogger(context: RequestContext) {
  return logger.child({
    requestId: context.requestId,
    correlationId: context.correlationId,
    userId: context.userId,
  });
}
