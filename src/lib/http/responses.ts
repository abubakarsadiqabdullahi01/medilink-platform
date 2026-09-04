import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthorizationError } from '../authz/guard';
import type { RequestContext } from './request-context';

/** One error shape for the whole API, so clients can act on failures. */
export interface ApiError {
  error: { code: string; message: string; details?: unknown; requestId: string };
}

export function ok<T>(data: T, context: RequestContext, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'x-request-id': context.requestId, 'x-correlation-id': context.correlationId },
  });
}

export function fail(
  code: string,
  message: string,
  context: RequestContext,
  status = 400,
  details?: unknown,
) {
  const body: ApiError = { error: { code, message, details, requestId: context.requestId } };
  return NextResponse.json(body, { status, headers: { 'x-request-id': context.requestId } });
}

/** Translates known error types; anything else is a 500 with no internals. */
export function handleError(error: unknown, context: RequestContext) {
  if (error instanceof AuthorizationError) {
    return fail('forbidden', 'You do not have permission to do that.', context, 403);
  }
  if (error instanceof ZodError) {
    return fail('validation_failed', 'Some details need correcting.', context, 422, error.flatten());
  }
  return fail('internal_error', 'Something went wrong. Please try again.', context, 500);
}
