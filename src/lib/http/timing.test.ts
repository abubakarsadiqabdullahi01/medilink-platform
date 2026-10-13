import { beforeEach, describe, expect, it } from 'vitest';
import {
  performanceReport,
  recordQuery,
  recordRequest,
  resetPerformanceStats,
  routeKey,
  serverTimingHeader,
  withTiming,
} from './timing';

const request = (route: string, totalMs: number, extra: { status?: number; dbMs?: number; queries?: number } = {}) =>
  recordRequest({
    route,
    status: extra.status ?? 200,
    totalMs,
    timing: { dbMs: extra.dbMs ?? 0, queries: extra.queries ?? 0 },
    bytes: 2048,
    slowMs: 500,
  });

beforeEach(() => resetPerformanceStats());

describe('naming a route', () => {
  it('folds ids so one route is one row, not a thousand', () => {
    expect(routeKey('get', '/api/v1/assignments/3f2b8d9e-1c4a-4e7b-9a55-0d1e2f3a4b5c/timesheet')).toBe(
      'GET /api/v1/assignments/:id/timesheet',
    );
    expect(routeKey('POST', '/api/v1/invoices')).toBe('POST /api/v1/invoices');
    expect(routeKey('GET', '/api/v1/x/123456')).toBe('GET /api/v1/x/:n');
  });
});

describe('counting a request’s queries', () => {
  it('adds each query to the request that made it', async () => {
    const { timing } = await withTiming(async () => {
      recordQuery(4);
      recordQuery(6);
    });
    expect(timing).toEqual({ queries: 2, dbMs: 10 });
  });

  it('keeps two concurrent requests apart', async () => {
    const [a, b] = await Promise.all([
      withTiming(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        recordQuery(1);
      }),
      withTiming(async () => {
        recordQuery(2);
        recordQuery(2);
      }),
    ]);
    expect(a.timing.queries).toBe(1);
    expect(b.timing.queries).toBe(2);
  });

  it('is a no-op outside a request, as in the worker', () => {
    expect(() => recordQuery(5)).not.toThrow();
  });
});

describe('the header', () => {
  it('reports total time and the database share in Server-Timing form', () => {
    expect(serverTimingHeader(123.456, { queries: 7, dbMs: 40.04 })).toBe(
      'total;dur=123.5, db;dur=40.0;desc="7 queries"',
    );
  });
});

describe('the aggregate', () => {
  it('reports percentiles, slowest route first', () => {
    for (let i = 1; i <= 100; i += 1) request('GET /api/v1/fast', i); // 1..100 ms
    for (let i = 1; i <= 10; i += 1) request('GET /api/v1/slow', 400 + i * 50); // 450..900 ms

    const [first, second] = performanceReport().routes;
    expect(first?.route).toBe('GET /api/v1/slow');
    expect(second?.route).toBe('GET /api/v1/fast');
    expect(second?.p50Ms).toBe(50);
    expect(second?.p95Ms).toBe(95);
    expect(second?.maxMs).toBe(100);
  });

  it('counts the slow ones, the failures, and averages queries and size', () => {
    expect(request('GET /api/v1/x', 100, { queries: 2, dbMs: 10 })).toBe(false);
    expect(request('GET /api/v1/x', 800, { queries: 4, dbMs: 30, status: 500 })).toBe(true);

    const row = performanceReport().routes[0]!;
    expect(row).toMatchObject({ count: 2, slow: 1, errors: 1, meanQueries: 3, meanDbMs: 20, meanKb: 2 });
  });

  it('keeps only a recent window, so a route that got faster looks faster', () => {
    for (let i = 0; i < 500; i += 1) request('GET /api/v1/x', 1000);
    for (let i = 0; i < 500; i += 1) request('GET /api/v1/x', 10);
    expect(performanceReport().routes[0]?.p95Ms).toBe(10);
  });
});
