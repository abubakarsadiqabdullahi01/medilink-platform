import { describe, expect, it } from 'vitest';
import { hasImage } from './images';

describe('hasImage', () => {
  const list = 'auth/shift-handover.webp,empty/offers.webp';

  it('is true only for a picture the build found', () => {
    expect(hasImage('auth/shift-handover.webp', list)).toBe(true);
    expect(hasImage('empty/offers.webp', list)).toBe(true);
    expect(hasImage('empty/shifts.webp', list)).toBe(false);
  });

  it('does not match part of a name', () => {
    expect(hasImage('empty/offers', list)).toBe(false);
    expect(hasImage('offers.webp', list)).toBe(false);
  });

  it('is false for everything when nothing was found, or the list is missing', () => {
    expect(hasImage('empty/offers.webp', '')).toBe(false);
    expect(hasImage('empty/offers.webp', undefined)).toBe(false);
  });
});
