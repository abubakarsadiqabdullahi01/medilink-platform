import { ZodError, type ZodSchema } from 'zod';
import { fail, handleError, ok } from '@/lib/http/responses';
import { contextLogger, requestContextFrom, type RequestContext } from '@/lib/http/request-context';
import { PhoneFormatError } from '@/lib/phone';
import { AuthError } from '../domain/errors';

/**
 * Shared plumbing for the auth routes: parse the body, run the action,
 * translate the failure. Without this, every route repeats the same
 * try/catch and they drift apart.
 */
export async function handleAuthRequest<TInput, TOutput>(
  request: Request,
  schema: ZodSchema<TInput>,
  action: (input: TInput, context: RequestContext) => Promise<TOutput>,
  successStatus = 200,
) {
  const context = requestContextFrom(request);
  const log = contextLogger(context);

  try {
    const body: unknown = await request.json().catch(() => ({}));
    const input = schema.parse(body);
    const result = await action(input, context);
    return ok(result, context, successStatus);
  } catch (error) {
    if (error instanceof AuthError) {
      const response = fail(error.code, error.message, context, error.status, {
        retryAfterSeconds: error.retryAfterSeconds,
      });
      if (error.retryAfterSeconds) {
        response.headers.set('retry-after', String(error.retryAfterSeconds));
      }
      return response;
    }
    if (error instanceof PhoneFormatError) {
      return fail(error.code, error.message, context, 422);
    }
    if (!(error instanceof ZodError)) {
      log.error('auth request failed', { error: String(error) });
    }
    return handleError(error, context);
  }
}
