import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What ties one business action together across the request that began it, the audit rows and
 * events it wrote, and the worker run that finished it (AUD-13).
 *
 * Ambient rather than passed. The correlation id was made for every request and logged, and
 * then never saved: `recordAudit` and `publishEvent` accepted one and none of the hundred call
 * sites passed one, because doing so means threading a context through every service function
 * between a route and the row. An `AsyncLocalStorage` makes it follow the `await`s instead. The
 * request wrappers, the event processor and the job runner each open a trace around what they
 * run; the two writers take the id from it when a caller has not given one.
 *
 * Outside any trace (a script, a test calling a service directly) there is none, and a row is
 * written without one, as before. A trace is scoped with `run`, not entered: entering would leak
 * one request's id into whatever the same async chain does next.
 */
export interface Trace {
  correlationId: string;
  /** The HTTP request, when there was one. A job or an event has none. */
  requestId?: string;
}

const store = new AsyncLocalStorage<Trace>();

/** Runs `run` with this trace as the current one, for it and everything it awaits. */
export function withTrace<T>(trace: Trace, run: () => Promise<T>): Promise<T> {
  return store.run(trace, run);
}

/** The trace of the action being run, or undefined when called outside one. */
export function currentTrace(): Trace | undefined {
  return store.getStore();
}
