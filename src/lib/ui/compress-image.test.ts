import { describe, expect, it } from 'vitest';
import { compressImage, fitWithin } from './compress-image';

describe('fitWithin', () => {
  it('shrinks the long side to the limit and keeps the shape', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(3000, 4000, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it('never enlarges', () => {
    expect(fitWithin(1200, 800, 2000)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(2000, 2000, 2000)).toEqual({ width: 2000, height: 2000 });
  });
});

describe('compressImage', () => {
  it('sends a PDF as it is', async () => {
    const pdf = new File([new Uint8Array(2_000_000)], 'licence.pdf', { type: 'application/pdf' });
    expect(await compressImage(pdf)).toBe(pdf);
  });

  it('leaves a small photograph alone', async () => {
    const small = new File([new Uint8Array(100_000)], 'photo.jpg', { type: 'image/jpeg' });
    expect(await compressImage(small)).toBe(small);
  });

  it('sends a file the browser cannot decode as it is, rather than failing the upload', async () => {
    // jsdom has no createImageBitmap, which is the same position as a browser that cannot read HEIC.
    const heic = new File([new Uint8Array(3_000_000)], 'photo.heic', { type: 'image/heic' });
    expect(await compressImage(heic)).toBe(heic);
    const undecodable = new File([new Uint8Array(3_000_000)], 'photo.jpg', { type: 'image/jpeg' });
    expect(await compressImage(undecodable)).toBe(undecodable);
  });
});
