import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * How long requests take, and where the time goes.
 *
 * The system logged failures and nothing about ordinary requests, so a slow
 * route could only be found by somebody noticing and clicking. This records,
 * for every request through `handleGuardedRequest`: the route, the status, the
 * total time, how much of it was the database and in how many queries, and the
 * size of the response. Three consumers:
 *
 *  - a `Server-Timing` header on the response, visible in any browser's
 *    network panel the moment a route is slow;
 *  - a structured warning when a request exceeds `SLOW_REQUEST_MS`;
 *  - an in-memory aggregate per route (count, p50, p95, max, mean database
 *    time, query count), read at `GET /api/v1/admin/performance`.
 *
 * In memory on purpose: it is a diagnostic for the person running the pilot,
 * not a metrics pipeline, and it costs nothing to keep. It resets when the
 * process restarts and is per process; a larger deployment would export the
 * same numbers to a real collector from `recordRequest`.
 */

export interface RequestTiming {
  queries: number;
  dbMs: number;
}

const storage = new AsyncLocalStorage<RequestTiming>();

/** Runs `fn` with a fresh counter that the database layer adds to. */
export function withTiming<T>(fn: () => Promise<T>): Promise<{ result: T; timing: RequestTiming }> {
  const timing: RequestTiming = { queries: 0, dbMs: 0 };
  return storage.run(timing, async () => ({ result: await fn(), timing }));
}

/** Called by the database layer for every query; a no-op outside a request. */
export function recordQuery(ms: number): void {
  const timing = storage.getStore();
  if (!timing) return;
  timing.queries += 1;
  timing.dbMs += ms;
}

/**
 * A route as people think of it: ids and long numbers folded to a placeholder,
 * so `/assignments/<uuid>/timesheet` is one route rather than a thousand.
 */
export function routeKey(method: string, pathname: string): string {
  const folded = pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d{4,}(?=\/|$)/g, '/:n');
  return `${method.toUpperCase()} ${folded}`;
}

export function serverTimingHeader(totalMs: number, timing: RequestTiming): string {
  return [
    `total;dur=${totalMs.toFixed(1)}`,
    `db;dur=${timing.dbMs.toFixed(1)};desc="${timing.queries} queries"`,
  ].join(', ');
}

interface RouteStats {
  count: number;
  slow: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  dbMs: number;
  queries: number;
  bytes: number;
  /** Fixed-size ring of recent durations, from which the percentiles are read. */
  recent: number[];
  next: number;
}

const WINDOW = 500;
const routes = new Map<string, RouteStats>();
const startedAt = new Date();

export interface RecordedRequest {
  route: string;
  status: number;
  totalMs: number;
  timing: RequestTiming;
  bytes: number;
  slowMs: number;
}

/** Folds one finished request into the aggregate. Returns whether it was slow. */
export function recordRequest(entry: RecordedRequest): boolean {
  let stats = routes.get(entry.route);
  if (!stats) {
    stats = { count: 0, slow: 0, errors: 0, totalMs: 0, maxMs: 0, dbMs: 0, queries: 0, bytes: 0, recent: [], next: 0 };
    routes.set(entry.route, stats);
  }
  const slow = entry.totalMs > entry.slowMs;
  stats.count += 1;
  if (slow) stats.slow += 1;
  if (entry.status >= 500) stats.errors += 1;
  stats.totalMs += entry.totalMs;
  stats.maxMs = Math.max(stats.maxMs, entry.totalMs);
  stats.dbMs += entry.timing.dbMs;
  stats.queries += entry.timing.queries;
  stats.bytes += entry.bytes;
  if (stats.recent.length < WINDOW) stats.recent.push(entry.totalMs);
  else {
    stats.recent[stats.next] = entry.totalMs;
    stats.next = (stats.next + 1) % WINDOW;
  }
  return slow;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export interface RouteReport {
  route: string;
  count: number;
  slow: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
  meanDbMs: number;
  meanQueries: number;
  meanKb: number;
}

/** Slowest first, by 95th percentile: the order somebody should fix things in. */
export function performanceReport(): { since: string; routes: RouteReport[] } {
  const rows: RouteReport[] = [];
  for (const [route, stats] of routes) {
    const sorted = [...stats.recent].sort((a, b) => a - b);
    rows.push({
      route,
      count: stats.count,
      slow: stats.slow,
      errors: stats.errors,
      p50Ms: Math.round(percentile(sorted, 50)),
      p95Ms: Math.round(percentile(sorted, 95)),
      maxMs: Math.round(stats.maxMs),
      meanMs: Math.round(stats.totalMs / stats.count),
      meanDbMs: Math.round(stats.dbMs / stats.count),
      meanQueries: Math.round((stats.queries / stats.count) * 10) / 10,
      meanKb: Math.round((stats.bytes / stats.count / 1024) * 10) / 10,
    });
  }
  rows.sort((a, b) => b.p95Ms - a.p95Ms || b.count - a.count);
  return { since: startedAt.toISOString(), routes: rows };
}

/** For tests, so one case's traffic is not another's. */
export function resetPerformanceStats(): void {
  routes.clear();
}
