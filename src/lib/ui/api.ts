'use client';

/**
 * The console's one way of talking to the API.
 *
 * Same origin, so the session cookie goes automatically and nothing here
 * handles a token. `credentials: 'same-origin'` is stated rather than left to
 * the default because the default has changed between browsers before and
 * silently losing the cookie would look like a permissions bug.
 */

export interface ApiFailure {
  code: string;
  message: string;
  details?: unknown;
  status: number;
}

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const envelope = parsed as { error?: { code: string; message: string; details?: unknown } };
    throw new ApiError({
      code: envelope.error?.code ?? 'unknown_error',
      message: envelope.error?.message ?? 'Something went wrong.',
      details: envelope.error?.details,
      status: response.status,
    });
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
};

/** Turns a Zod field-error payload into something a person can read. */
export function fieldErrors(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const details = error.failure.details as
    | { fieldErrors?: Record<string, string[]>; formErrors?: string[] }
    | undefined;
  if (!details) return [];

  const messages: string[] = [...(details.formErrors ?? [])];
  for (const [field, list] of Object.entries(details.fieldErrors ?? {})) {
    for (const message of list) messages.push(`${field}: ${message}`);
  }
  return messages;
}
