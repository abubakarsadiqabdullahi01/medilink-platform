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

/**
 * Requests started before they were asked for.
 *
 * Hovering a sidebar link is a reliable signal that somebody is about to
 * click it, and the click costs a round trip the console then shows a
 * skeleton for. Starting the GET on hover usually finishes it before the page
 * has mounted, so the queue is already there.
 *
 * **Keyed by URL, not by query key.** Seeding React Query's cache directly
 * would mean the sidebar having to reproduce each page's exact key, including
 * its default filters, and a page that changed a default would silently stop
 * matching — a prefetch that fetched, threw the answer away and told nobody.
 * Warming the URL couples the two on the one string they already share, and a
 * miss costs a normal fetch rather than a wrong one.
 *
 * An entry is **consumed once and discarded**. It is "the request you were
 * about to make, started early", never a cache: a refetch after a mutation
 * must go to the server, and one that quietly got a three-second-old body
 * would be a queue that does not update after you work a row.
 */
const PREFETCH_TTL_MS = 30_000;

const warmed = new Map<string, { at: number; promise: Promise<unknown> }>();

export function prefetch(path: string): void {
  const existing = warmed.get(path);
  if (existing && Date.now() - existing.at < PREFETCH_TTL_MS) return;

  // The rejection is attached here so an unawaited prefetch of something the
  // caller is not allowed to see cannot surface as an unhandled rejection.
  // The promise handed to a real caller still rejects normally.
  const promise = request<unknown>('GET', path);
  promise.catch(() => warmed.delete(path));

  warmed.set(path, { at: Date.now(), promise });
}

function takeWarmed<T>(path: string): Promise<T> | null {
  const entry = warmed.get(path);
  if (!entry) return null;

  warmed.delete(path);
  if (Date.now() - entry.at > PREFETCH_TTL_MS) return null;

  return entry.promise as Promise<T>;
}

export const api = {
  get: <T>(path: string) => takeWarmed<T>(path) ?? request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** The message to show a person, field errors included. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong.';
  const fields = error.fieldMessages;
  return fields.length > 0 ? `${error.message} ${fields.join('; ')}` : error.message;
}
