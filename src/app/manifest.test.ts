import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UXA-08. The manifest had `"icons": []`, so a phone offered nothing to install
 * and a Gombe practitioner could not put Medilink on the home screen.
 */

const root = join(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.webmanifest'), 'utf8')) as {
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
  theme_color: string;
};

/** Width and height from a PNG's header, which is how a browser checks too. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('the web app manifest', () => {
  it('declares the icons a phone needs to offer installation', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('has an icon that survives being cropped to a circle', () => {
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it.each(manifest.icons.map((icon) => [icon.src, icon] as const))('has %s on disk, at the size it says', (src, icon) => {
    const path = join(root, 'public', src.replace(/^\//, ''));
    expect(existsSync(path)).toBe(true);
    expect(icon.type).toBe('image/png');
    const [width, height] = icon.sizes.split('x').map(Number);
    expect(pngSize(path)).toEqual({ width, height });
  });
});
