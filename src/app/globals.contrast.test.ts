import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UXA-03. Contrast was measured by hand once and fell short in places that
 * matter to a reader in bright light: an input border at 1.31:1, the commonest
 * status badge (every "pending" and "open") at 3.0:1, grey text on a grey tint
 * at 4.19:1, the destructive badge in dark mode at 3.4:1.
 *
 * This reads the real stylesheet, so a token edited later cannot quietly
 * undo it. WCAG 2.2 AA: 4.5:1 for text, 3:1 for the edge of a control.
 */

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

type Rgb = [number, number, number];
type Tokens = Record<string, Rgb>;

function hslToRgb(h: number, s: number, l: number): Rgb {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] =
    h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [r + m, g + m, b + m];
}

/** The `--name: H S% L%;` declarations inside one block. */
function tokensIn(blockSelector: string): Tokens {
  const start = css.indexOf(`${blockSelector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens: Tokens = {};
  for (const [, name, h, s, l] of body.matchAll(/--([a-z0-9-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)) {
    tokens[name!] = hslToRgb(Number(h), Number(s), Number(l));
  }
  return tokens;
}

const luminance = ([r, g, b]: Rgb) => {
  const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a: Rgb, b: Rgb) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
};
const over = (foreground: Rgb, background: Rgb, alpha: number): Rgb =>
  foreground.map((value, index) => value * alpha + background[index]! * (1 - alpha)) as Rgb;

const modes: [string, Tokens][] = [
  ['light', tokensIn(':root')],
  ['dark', tokensIn('.dark')],
];

describe.each(modes)('%s mode', (_mode, t) => {
  const text: [string, Rgb, Rgb][] = [
    ['body text on the page', t.foreground!, t.background!],
    ['body text on a card', t['card-foreground']!, t.card!],
    ['secondary text on the page', t['muted-foreground']!, t.background!],
    ['secondary text on a card', t['muted-foreground']!, t.card!],
    ['secondary text on a grey tint', t['muted-foreground']!, t.muted!],
    ['text on a primary button', t['primary-foreground']!, t.primary!],
    ['text on a destructive button', t['destructive-foreground']!, t.destructive!],
    ['text on a success button', t['success-foreground']!, t.success!],
    ['text on a warning button', t['warning-foreground']!, t.warning!],
    ['text on an info button', t['info-foreground']!, t.info!],
    ['default badge', t.primary!, over(t.primary!, t.card!, 0.1)],
    ['secondary badge', t['secondary-foreground']!, t.secondary!],
    ['destructive badge', t['destructive-text']!, over(t.destructive!, t.card!, 0.1)],
    ['success badge', t.success!, over(t.success!, t.card!, 0.1)],
    ['warning badge, the commonest', t.warning!, over(t.warning!, t.card!, 0.15)],
    ['info badge', t.info!, over(t.info!, t.card!, 0.1)],
  ];

  it.each(text)('%s reads at 4.5:1 or better', (_name, foreground, background) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['the edge of a field on the page', t.background!],
    ['the edge of a field on a card', t.card!],
  ])('%s is visible at 3:1 or better', (_name, surface) => {
    expect(ratio(t.input!, surface)).toBeGreaterThanOrEqual(3);
  });
});
