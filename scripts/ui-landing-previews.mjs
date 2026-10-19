/**
 * The product previews on the landing page, photographed from the running app.
 *
 *   node scripts/ui-landing-previews.mjs --out /tmp/previews
 *   # then, for each PNG (WebP is what the page serves; Pillow shown, any encoder will do):
 *   python3 -c "from PIL import Image; im=Image.open('preview-facility.png'); im.thumbnail((1600,1600)); im.save('public/landing/preview-facility.webp', quality=80, method=6)"
 *
 * Needs the app running with the demo world seeded (`pnpm tsx scripts/seed-demo.ts`). Everything
 * photographed is seeded demonstration data: the people, facility, shifts and amounts are invented
 * and say so on the page. It signs in through the API, reads two pages and clicks nothing.
 *
 * One thing is removed from the facility shot: the "documents to accept" banner. The demo
 * accounts have not accepted the current terms, so it shows on every run; a facility that has
 * accepted them — which is every facility after its first visit — does not see it, and the shot
 * is of that ordinary state.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const BASE_URL = flag('base', process.env.BASE_URL ?? 'http://localhost:3000');
const OUT = flag('out', 'previews');
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Medilink-demo-2026';

const SHOTS = [
  {
    slug: 'preview-practitioner',
    phone: '+2348031200021',
    path: '/practitioner',
    width: 390,
    height: 844,
  },
  {
    slug: 'preview-facility',
    phone: '+2348031200013',
    path: '/facility',
    width: 1440,
    height: 900,
  },
  {
    slug: 'preview-facility-phone',
    phone: '+2348031200013',
    path: '/facility',
    width: 390,
    height: 844,
  },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

for (const shot of SHOTS) {
  const phoneSized = shot.width < 600;
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    isMobile: phoneSized,
    hasTouch: phoneSized,
    timezoneId: 'Africa/Lagos',
    locale: 'en-NG',
  });
  const login = await context.request.post(`${BASE_URL}/api/v1/auth/login`, {
    data: { phone: shot.phone, password: PASSWORD },
  });
  if (!login.ok()) throw new Error(`sign-in failed for ${shot.slug}: ${login.status()}`);

  const page = await context.newPage();
  await page.goto(`${BASE_URL}${shot.path}`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page
    .waitForFunction(
      () => !document.querySelector('.animate-pulse,[aria-busy="true"]'),
      undefined,
      {
        timeout: 20_000,
      },
    )
    .catch(() => {});
  // The banner arrives with the dashboard's data, after the page has settled.
  await page
    .getByText(/documents? to accept/)
    .first()
    .waitFor({ timeout: 8_000 })
    .catch(() => {});
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('body *')) {
      const text = node.textContent ?? '';
      if (node.children.length < 3 && text.length < 40 && /documents? to accept/.test(text)) {
        node.closest('.bg-card')?.remove();
        break;
      }
    }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${shot.slug}.png`) });
  await context.close();
}

await browser.close();
console.log(`Wrote ${SHOTS.length} screenshots to ${OUT}`);
