/**
 * What a first visit costs in a browser, on a slow connection.
 *
 *   dashboards     at most 5 API requests
 *   any page       no route fetched more than twice (that would be a request per row),
 *                  and no failed request
 *   navigation     visible and clickable within 2 s of the request on a throttled link
 *
 * Every page is opened in a fresh browser context — an empty cache, as on a
 * first visit — over Chrome's "Slow 4G" (1.6 Mbps down, 150 ms round trip) with
 * the CPU slowed fourfold, which is closer to a ward-office laptop than to the
 * machine the system was built on. Exits non-zero on a breach.
 *
 * Needs a *production* build on the `_perf` database (the numbers are about the
 * system, not the compiler):
 *
 *   E2E_DATABASE_URL=postgresql://medilink:medilink@db:5432/medilink_perf?schema=public \
 *     docker compose --profile e2e up -d --force-recreate e2e
 *   node scripts/page-budget.mjs            # BASE_URL defaults to http://localhost:3100
 */
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3100';
const PASSWORD = 'Medilink-demo-2026';
const NAV_BUDGET_MS = 2000;
const DASHBOARD_REQUEST_BUDGET = 5;
const REPEAT_BUDGET = 2;

const WHO = {
  admin: '+2348031200001',
  owner: '+2348031200002',
  practitioner: '+2348030000001',
};

/** [who, path, isDashboard] */
const PAGES = [
  ['admin', '/admin', true],
  ['admin', '/admin/finance', true],
  ['admin', '/admin/audit', false],
  ['admin', '/admin/performance', false],
  ['owner', '/facility', true],
  ['owner', '/facility/roster', false],
  ['owner', '/facility/timesheets', false],
  ['owner', '/facility/invoices', false],
  ['practitioner', '/practitioner', true],
  ['practitioner', '/practitioner/shifts', false],
  ['practitioner', '/practitioner/timesheets', false],
];

/** An id in a path is the same route whichever id it is. */
const fold = (url) =>
  new URL(url).pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');

const browser = await chromium.launch({ channel: 'chrome' });
let breaches = 0;

console.log(`${BASE_URL}  Slow 4G, CPU x4, empty cache\n`);
console.log('page'.padEnd(26), 'nav ms'.padStart(7), 'done ms'.padStart(8), 'api'.padStart(4), 'worst repeat'.padStart(13), 'KB js (wire)'.padStart(13), ' verdict');

for (const [who, path, isDashboard] of PAGES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await context.request.post(`${BASE_URL}/api/v1/auth/login`, {
    data: { phone: WHO[who], password: PASSWORD },
  });
  if (!login.ok()) throw new Error(`Sign-in as ${who} failed: ${login.status()}`);

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const calls = new Map();
  let failed = 0;
  let jsBytes = 0;
  const scripts = new Set();
  cdp.on('Network.responseReceived', (event) => {
    if (event.type === 'Script') scripts.add(event.requestId);
  });
  cdp.on('Network.loadingFinished', (event) => {
    if (scripts.has(event.requestId)) jsBytes += event.encodedDataLength;
  });
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes('/api/')) return;
    const key = `${response.request().method()} ${fold(url)}`;
    calls.set(key, (calls.get(key) ?? 0) + 1);
    if (response.status() >= 400) failed += 1;
  });

  const started = Date.now();
  await page.goto(BASE_URL + path, { waitUntil: 'commit' });
  await page.locator('nav a').first().waitFor({ state: 'visible', timeout: 60_000 });
  const navMs = Date.now() - started;
  await page.waitForSelector('main h1', { timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  const doneMs = Date.now() - started;

  const total = [...calls.values()].reduce((a, b) => a + b, 0);
  const [worstRoute, worst] = [...calls.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];

  const problems = [];
  if (navMs > NAV_BUDGET_MS) problems.push(`nav ${navMs} ms > ${NAV_BUDGET_MS}`);
  if (isDashboard && total > DASHBOARD_REQUEST_BUDGET) problems.push(`${total} API requests > ${DASHBOARD_REQUEST_BUDGET}`);
  if (worst > REPEAT_BUDGET) problems.push(`${worstRoute} x${worst}`);
  if (failed > 0) problems.push(`${failed} failed`);
  if (problems.length) breaches += 1;

  console.log(
    `${who} ${path}`.padEnd(26),
    String(navMs).padStart(7),
    String(doneMs).padStart(8),
    String(total).padStart(4),
    String(worst).padStart(13),
    String(Math.round(jsBytes / 1024)).padStart(13),
    problems.length ? ` OVER: ${problems.join('; ')}` : ' ok',
  );
  await context.close();
}

await browser.close();
console.log(breaches ? `\n${breaches} of ${PAGES.length} pages outside budget.` : `\nAll ${PAGES.length} pages inside budget.`);
process.exit(breaches ? 1 : 0);
