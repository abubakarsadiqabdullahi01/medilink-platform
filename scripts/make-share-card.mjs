/**
 * Draws the 1200×630 card that appears when a link to Medilink is shared (public/og.jpg).
 *
 * Composed in code, not in a design tool, so it can be redrawn when the photograph, the words or the
 * brand colours change, and so the logo in it is the real one. It uses the hero photograph, the
 * outlined wordmark in public/brand and the self-hosted typeface.
 *
 *   node scripts/make-share-card.mjs
 *
 * Needs Playwright's Chromium (already a dev dependency). Not part of the build: the output is
 * committed, because a share card that changes on every deploy is a share card that is cached wrongly.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const uri = (path, type) => `data:${type};base64,${read(path).toString('base64')}`;

const html = `<!doctype html><html><head><style>
  @font-face { font-family: 'Jakarta'; src: url(${uri('src/app/fonts/PlusJakartaSans-latin-wght.woff2', 'font/woff2')}) format('woff2'); font-weight: 200 800; }
  * { box-sizing: border-box; margin: 0 }
  body { width: 1200px; height: 630px; position: relative; overflow: hidden; background: #062a2e; font-family: 'Jakarta', system-ui, sans-serif; }
  .photo { position: absolute; inset: 0; background: url(${uri('public/medilink-hero.webp', 'image/webp')}) 66% center / cover; }
  .scrim { position: absolute; inset: 0; background: linear-gradient(90deg, #062a2e 0%, rgba(6,42,46,.94) 38%, rgba(6,42,46,.35) 70%, rgba(6,42,46,.05) 100%); }
  .copy { position: absolute; left: 72px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
  .logo { height: 54px; margin-bottom: 44px; align-self: flex-start; }
  h1 { color: #fff; font-size: 62px; line-height: 1.06; font-weight: 650; letter-spacing: -0.02em; }
  p { margin-top: 26px; color: #7fd3cf; font-size: 17px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; }
</style></head><body>
  <div class="photo"></div><div class="scrim"></div>
  <div class="copy">
    <img class="logo" src="${uri('public/brand/medilink-logo-reverse.svg', 'image/svg+xml')}" alt="">
    <h1>The right practitioner, on the right shift.</h1>
    <p>Healthcare workforce management · Nigeria</p>
  </div>
</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
writeFileSync(new URL('public/og.jpg', root), await page.screenshot({ type: 'jpeg', quality: 86 }));
await browser.close();
console.log('wrote public/og.jpg');
