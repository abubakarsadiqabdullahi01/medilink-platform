/**
 * Screenshots and layout measurements of representative pages, for the UI audit
 * and for visual regression.
 *
 *   node scripts/ui-screenshots.mjs --out docs/ui-screenshots/before
 *   node scripts/ui-screenshots.mjs --out docs/ui-screenshots/after --theme dark
 *   node scripts/ui-screenshots.mjs --only landing,practitioner-dashboard --widths 390 --max-height 2400
 *
 * Needs the app running with the demo world seeded (`pnpm tsx scripts/seed-demo.ts`).
 * It signs in through the API, as the browser journeys do, so no password is typed.
 * Everything photographed is seeded demonstration data.
 *
 * Alongside each image it measures what a screenshot cannot show: sideways overflow,
 * controls smaller than the 24px WCAG 2.2 floor (SC 2.5.8) and the 44px aim, text under
 * 14px, and the number of API requests the page made. `metrics.json` is written next to the
 * images so two runs can be compared by a script rather than by eye.
 *
 * It does not change anything. Pages are only read; nothing is clicked.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const BASE_URL = flag('base', process.env.BASE_URL ?? 'http://localhost:3000');
const OUT = flag('out', 'docs/ui-screenshots/run');
const THEME = flag('theme', 'light');
const TEXT_SIZE = flag('text', 'normal');
const ONLY = flag('only', '')
  .split(',')
  .filter(Boolean);
const WIDTHS = flag('widths', '390,768,1440')
  .split(',')
  .map(Number);
// Long lists make enormous images; the top of a page is what a reviewer compares.
const MAX_HEIGHT = Number(flag('max-height', '0')) || 0;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Medilink-demo-2026';

const PEOPLE = {
  admin: '+2348031200002',
  owner: '+2348031200011',
  facility: '+2348031200013',
  practitioner: '+2348031200021',
  newcomer: '+2348031200025',
};

/** [slug, who, path]. `who` null is the public site. */
const PAGES = [
  ['landing', null, '/'],
  ['login', null, '/login'],
  ['register', null, '/register'],
  ['register-facility', null, '/register?as=facility'],
  ['practitioner-dashboard', 'practitioner', '/practitioner'],
  ['practitioner-offers', 'practitioner', '/practitioner/offers'],
  ['practitioner-shifts', 'practitioner', '/practitioner/shifts'],
  ['practitioner-timesheets', 'practitioner', '/practitioner/timesheets'],
  ['practitioner-earnings', 'practitioner', '/practitioner/earnings'],
  ['practitioner-profile', 'practitioner', '/practitioner/profile'],
  ['practitioner-credentials', 'practitioner', '/practitioner/profile?tab=credentials'],
  ['practitioner-availability', 'practitioner', '/practitioner/profile?tab=availability'],
  ['practitioner-setup', 'newcomer', '/practitioner/profile'],
  ['facility-dashboard', 'facility', '/facility'],
  ['facility-shifts', 'facility', '/facility/shifts'],
  ['facility-roster', 'facility', '/facility/roster'],
  ['facility-timesheets', 'facility', '/facility/timesheets'],
  ['facility-invoices', 'facility', '/facility/invoices'],
  ['facility-staff', 'owner', '/facility/staff'],
  ['facility-profile', 'facility', '/facility/profile'],
  ['admin-dashboard', 'admin', '/admin'],
  ['admin-credentials', 'admin', '/admin/credentials'],
  ['admin-practitioners', 'admin', '/admin/practitioners'],
  ['admin-facilities', 'admin', '/admin/facilities'],
  ['admin-incidents', 'admin', '/admin/incidents'],
  ['admin-disputes', 'admin', '/admin/disputes'],
  ['admin-invoices', 'admin', '/admin/invoices'],
  ['admin-payouts', 'admin', '/admin/payouts'],
  ['admin-audit', 'admin', '/admin/audit'],
  ['admin-system', 'admin', '/admin/system'],
];

const HEIGHTS = { 390: 844, 768: 1024, 1024: 768, 1440: 900 };

/** Measured inside the page. Written as a string-free function so it is serialised whole. */
function measure() {
  const root = document.documentElement;
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const describe = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
      typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''
    } "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;

  const controls = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem]')].filter(visible);
  const small = [];
  const medium = [];
  for (const el of controls) {
    // Inline links in running text are exempt from SC 2.5.8, so only count them when they stand alone.
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    const box = el.getBoundingClientRect();
    const min = Math.min(box.width, box.height);
    // Visually hidden until focused (the skip link) is not a target a pointer can miss.
    if (inline || box.width <= 1) continue;
    if (min < 24) small.push(describe(el));
    else if (min < 44) medium.push(describe(el));
  }

  const tiny = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent || !visible(parent)) continue;
    const size = parseFloat(getComputedStyle(parent).fontSize);
    if (size < 13.99) tiny.set(`${size.toFixed(1)}px`, (tiny.get(`${size.toFixed(1)}px`) ?? 0) + 1);
  }

  const wide = [...document.querySelectorAll('body *')]
    .filter((el) => visible(el) && el.getBoundingClientRect().right > root.clientWidth + 1)
    .slice(0, 5)
    .map(describe);

  return {
    overflowPx: root.scrollWidth - root.clientWidth,
    documentHeight: root.scrollHeight,
    controls: controls.length,
    under24: small.length,
    under24Examples: small.slice(0, 6),
    from24to43: medium.length,
    textUnder14: Object.fromEntries(tiny),
    overflowing: wide,
    h1: document.querySelectorAll('h1').length,
    imagesWithoutAlt: [...document.images].filter((img) => !img.hasAttribute('alt')).length,
    inputsWithoutName: [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
      .filter(visible)
      .filter((el) => !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).length,
    buttonsWithoutName: [...document.querySelectorAll('button, [role=button], a[href]')]
      .filter(visible)
      .filter((el) => !(el.textContent ?? '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.getAttribute('title')).length,
  };
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' });
const results = [];

for (const width of WIDTHS) {
  // One context per person per width: a signed-in session, the Lagos zone, and the chosen
  // theme and text size set before the first paint so there is no flash to wait out.
  const contexts = new Map();
  const contextFor = async (who) => {
    if (contexts.has(who)) return contexts.get(who);
    const context = await browser.newContext({
      viewport: { width, height: HEIGHTS[width] ?? 900 },
      timezoneId: 'Africa/Lagos',
      locale: 'en-NG',
      deviceScaleFactor: 1,
      isMobile: width < 600,
      hasTouch: width < 600,
      reducedMotion: 'reduce',
    });
    await context.addInitScript(
      ([theme, textSize]) => {
        try {
          window.localStorage.setItem('medilink:theme', theme);
          window.localStorage.setItem('medilink:text-size', textSize);
        } catch {}
      },
      [THEME, TEXT_SIZE],
    );
    if (who) {
      const response = await context.request.post(`${BASE_URL}/api/v1/auth/login`, {
        data: { phone: PEOPLE[who], password: PASSWORD },
      });
      if (!response.ok()) throw new Error(`sign-in as ${who} failed: HTTP ${response.status()}`);
    }
    contexts.set(who, context);
    return context;
  };

  for (const [slug, who, path] of PAGES) {
    if (ONLY.length && !ONLY.includes(slug)) continue;
    const context = await contextFor(who);
    const page = await context.newPage();
    const api = [];
    const failed = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) api.push(new URL(request.url()).pathname);
    });
    page.on('response', (response) => {
      if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/api/')) {
        failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    const started = Date.now();
    try {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 90_000 });
      // A dev server's own badge is not part of the product.
      await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
      // "Settled" means the skeletons are gone, not just that the network went quiet: a slow API
      // route can leave a page showing its loading state while nothing is in flight for 500ms.
      await page
        .waitForFunction(() => !document.querySelector('.animate-pulse, [aria-busy="true"]'), undefined, { timeout: 20_000 })
        .catch(() => undefined);
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(measure);
      const file = `${slug}-${width}${THEME === 'dark' ? '-dark' : ''}${TEXT_SIZE !== 'normal' ? `-${TEXT_SIZE}` : ''}.jpg`;
      await page.screenshot({
        path: join(OUT, file),
        fullPage: true,
        type: 'jpeg',
        quality: 72,
        ...(MAX_HEIGHT && metrics.documentHeight > MAX_HEIGHT
          ? { clip: { x: 0, y: 0, width, height: MAX_HEIGHT } }
          : {}),
      });
      results.push({
        slug,
        width,
        path,
        file,
        ms: Date.now() - started,
        apiRequests: api.length,
        apiRoutes: [...new Set(api)],
        failedRequests: failed,
        ...metrics,
      });
      console.log(
        `${slug.padEnd(26)} ${String(width).padStart(4)}  overflow ${String(metrics.overflowPx).padStart(4)}px  <24px ${String(metrics.under24).padStart(3)}  api ${String(api.length).padStart(2)}${failed.length ? `  FAILED ${failed.join(', ')}` : ''}`,
      );
    } catch (error) {
      console.log(`${slug.padEnd(26)} ${String(width).padStart(4)}  ERROR ${String(error).split('\n')[0]}`);
      results.push({ slug, width, path, error: String(error).split('\n')[0] });
    } finally {
      await page.close();
    }
  }
  for (const context of contexts.values()) await context.close();
}

const suffix = `${THEME === 'dark' ? '-dark' : ''}${TEXT_SIZE !== 'normal' ? `-${TEXT_SIZE}` : ''}`;
writeFileSync(join(OUT, `metrics${suffix}.json`), JSON.stringify(results, null, 2));
await browser.close();
