/**
 * Does the API stay inside its budget on production-sized data?
 *
 *   normal routes        p95 under 300 ms
 *   aggregation routes   p95 under 750 ms     (dashboards, finance summary)
 *
 * Signs in as the two accounts scripts/seed-performance.ts creates, then calls
 * each route repeatedly with a few requests in flight, as a handful of staff
 * would. Latency is measured from the client, so it includes the network hop
 * and JSON serialisation; the server's own split (total, database, query count)
 * comes from the Server-Timing header and is shown beside it.
 *
 *   BASE_URL=http://localhost:3200 pnpm tsx scripts/load-test.ts
 *
 * Point it at a *production* server (`next start`) on the `_perf` database.
 * Against `next dev` the numbers describe the compiler, not the system.
 * Exits non-zero if any route breaks its budget or returns an error, so it can
 * gate a release.
 */
import { createHash } from 'node:crypto';
import { DEMO_PASSWORD } from './support/demo';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3200';
const REQUESTS = Number(process.env.REQUESTS ?? 40);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

const NORMAL_BUDGET_MS = 300;
const AGGREGATION_BUDGET_MS = 750;

/** md5 of a label, laid out as the UUID Postgres makes from it in the seed. */
function seededUuid(label: string): string {
  const hex = createHash('md5').update(label).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const FLAGSHIP = seededUuid('perf-facility-1');

type Kind = 'normal' | 'aggregation';
interface Probe {
  as: 'admin' | 'owner';
  kind: Kind;
  name: string;
  path: string;
}

const PROBES: Probe[] = [
  { as: 'admin', kind: 'aggregation', name: 'platform dashboard', path: '/api/v1/dashboard/platform' },
  { as: 'admin', kind: 'aggregation', name: 'finance dashboard', path: '/api/v1/dashboard/finance' },
  { as: 'admin', kind: 'normal', name: 'platform invoices, page 1', path: '/api/v1/finance/invoices?limit=25' },
  { as: 'admin', kind: 'normal', name: 'platform invoices, issued', path: '/api/v1/finance/invoices?status=ISSUED&limit=25' },
  { as: 'admin', kind: 'normal', name: 'platform invoices, search', path: '/api/v1/finance/invoices?search=Perf%20Hospital%20042&limit=25' },
  { as: 'admin', kind: 'normal', name: 'audit log, latest', path: '/api/v1/audit?scopeType=PLATFORM&limit=50' },
  { as: 'admin', kind: 'normal', name: 'audit log, one entity type', path: '/api/v1/audit?scopeType=PLATFORM&entityType=invoice&limit=50' },
  { as: 'admin', kind: 'normal', name: 'facilities', path: '/api/v1/facilities?scopeType=PLATFORM&limit=50' },
  { as: 'owner', kind: 'aggregation', name: 'facility dashboard', path: `/api/v1/dashboard/facility?facilityId=${FLAGSHIP}` },
  { as: 'owner', kind: 'normal', name: 'roster', path: `/api/v1/assignments?scopeType=FACILITY&scopeId=${FLAGSHIP}&limit=50` },
  { as: 'owner', kind: 'normal', name: 'roster with timesheets', path: `/api/v1/assignments?scopeType=FACILITY&scopeId=${FLAGSHIP}&include=timesheet&limit=50` },
  { as: 'owner', kind: 'normal', name: 'roster, confirmed only', path: `/api/v1/assignments?scopeType=FACILITY&scopeId=${FLAGSHIP}&status=CONFIRMED&include=attendance&limit=50` },
  { as: 'owner', kind: 'normal', name: 'shifts', path: `/api/v1/service-requests?scopeType=FACILITY&scopeId=${FLAGSHIP}&limit=50` },
  { as: 'owner', kind: 'normal', name: 'shifts, filled', path: `/api/v1/service-requests?scopeType=FACILITY&scopeId=${FLAGSHIP}&status=FILLED&limit=50` },
  { as: 'owner', kind: 'normal', name: 'facility invoices', path: `/api/v1/invoices?facilityId=${FLAGSHIP}&billedOnly=true&limit=25` },
];

async function signIn(phone: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, password: DEMO_PASSWORD }),
  });
  if (!response.ok) throw new Error(`Sign-in as ${phone} failed: ${response.status} ${await response.text()}`);
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

interface Result {
  probe: Probe;
  ok: number;
  failed: number;
  firstError: string;
  p50: number;
  p95: number;
  max: number;
  serverTotal: number;
  serverDb: number;
  queries: number;
  kb: number;
}

async function measure(probe: Probe, cookie: string): Promise<Result> {
  const latencies: number[] = [];
  const totals: number[] = [];
  const dbs: number[] = [];
  const queries: number[] = [];
  let bytes = 0;
  let failed = 0;
  let firstError = '';

  const once = async (record: boolean) => {
    const started = performance.now();
    const response = await fetch(`${BASE_URL}${probe.path}`, { headers: { cookie } });
    const body = await response.arrayBuffer();
    const elapsed = performance.now() - started;
    if (!response.ok) {
      if (record) {
        failed += 1;
        if (!firstError) firstError = `${response.status} ${new TextDecoder().decode(body).slice(0, 160)}`;
      }
      return;
    }
    if (!record) return;
    latencies.push(elapsed);
    bytes += body.byteLength;
    const timing = response.headers.get('server-timing') ?? '';
    totals.push(Number(/total;dur=([\d.]+)/.exec(timing)?.[1] ?? 0));
    dbs.push(Number(/db;dur=([\d.]+)/.exec(timing)?.[1] ?? 0));
    queries.push(Number(/desc="(\d+) queries"/.exec(timing)?.[1] ?? 0));
  };

  // Warm the connection, the plan cache and the JIT; nobody's first request is the measured one.
  for (let i = 0; i < 3; i += 1) await once(false);

  let issued = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (issued < REQUESTS) {
        issued += 1;
        await once(true);
      }
    }),
  );

  const sorted = [...latencies].sort((a, b) => a - b);
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  return {
    probe,
    ok: latencies.length,
    failed,
    firstError,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? 0,
    serverTotal: mean(totals),
    serverDb: mean(dbs),
    queries: mean(queries),
    kb: latencies.length ? bytes / latencies.length / 1024 : 0,
  };
}

async function main() {
  const cookies = {
    admin: await signIn('+2348031200001'),
    owner: await signIn('+2348031200002'),
  };

  console.log(`${BASE_URL}  ${REQUESTS} requests per route, ${CONCURRENCY} at a time\n`);
  console.log('route'.padEnd(30), 'p50'.padStart(6), 'p95'.padStart(6), 'max'.padStart(6), ' server'.padStart(8), '   db'.padStart(7), 'qry'.padStart(5), '   KB'.padStart(7), ' budget');

  const results: Result[] = [];
  for (const probe of PROBES) {
    const result = await measure(probe, cookies[probe.as]);
    results.push(result);
    const budget = probe.kind === 'aggregation' ? AGGREGATION_BUDGET_MS : NORMAL_BUDGET_MS;
    const verdict = result.failed > 0 ? 'ERROR' : result.p95 <= budget ? 'ok' : 'OVER';
    console.log(
      probe.name.padEnd(30),
      result.p50.toFixed(0).padStart(6),
      result.p95.toFixed(0).padStart(6),
      result.max.toFixed(0).padStart(6),
      result.serverTotal.toFixed(0).padStart(8),
      result.serverDb.toFixed(0).padStart(7),
      result.queries.toFixed(0).padStart(5),
      result.kb.toFixed(1).padStart(7),
      ` ${verdict} (${budget})`,
    );
    if (result.failed > 0) console.log(`  ${result.failed} failed; first: ${result.firstError}`);
  }

  const bad = results.filter(
    (r) => r.failed > 0 || r.p95 > (r.probe.kind === 'aggregation' ? AGGREGATION_BUDGET_MS : NORMAL_BUDGET_MS),
  );
  console.log(bad.length ? `\n${bad.length} of ${results.length} routes outside budget.` : `\nAll ${results.length} routes inside budget.`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
