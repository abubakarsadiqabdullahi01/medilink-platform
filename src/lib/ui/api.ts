/**
 * The console's one way of talking to the API.
 *
 * Same origin, so the session cookie goes automatically and nothing here
 * handles a token. `credentials: 'same-origin'` is stated rather than left to
 * the default because the default has changed between browsers before, and
 * silently losing the cookie would present as a permissions bug.
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

  /** Field-level messages from Zod, flattened into something readable. */
  get fieldMessages(): string[] {
    const details = this.failure.details as
      | { fieldErrors?: Record<string, string[]>; formErrors?: string[] }
      | undefined;
    if (!details) return [];

    const messages = [...(details.formErrors ?? [])];
    for (const [field, list] of Object.entries(details.fieldErrors ?? {})) {
      for (const message of list) messages.push(`${field}: ${message}`);
    }
    return messages;
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
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // A non-JSON body means Next served an HTML error page rather than a
    // route — almost always a new segment the dev server has not picked up.
    throw new ApiError({
      code: 'unexpected_response',
      message: `The server did not return JSON (${response.status}). If this route is new, restart the web container.`,
      status: response.status,
    });
  }

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

/** The message to show a person, field errors included. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong.';
  const fields = error.fieldMessages;
  return fields.length > 0 ? `${error.message} ${fields.join('; ')}` : error.message;
}
