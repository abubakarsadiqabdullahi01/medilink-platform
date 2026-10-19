import { describe, expect, it } from 'vitest';
import { nairaTick } from './naira-axis';

describe('nairaTick', () => {
  it('says whole naira below a thousand', () => {
    expect(nairaTick(0)).toBe('₦0');
    expect(nairaTick(80_000)).toBe('₦800');
  });

  it('shortens thousands and keeps one decimal only when there is one', () => {
    expect(nairaTick(25_000_000)).toBe('₦250k');
    // 150,000,000 kobo is ₦1,500,000: a million and a half.
    expect(nairaTick(150_000_000)).toBe('₦1.5M');
    expect(nairaTick(180_000_000)).toBe('₦1.8M');
  });

  it('shortens millions the same way', () => {
    expect(nairaTick(600_000_000)).toBe('₦6M');
    expect(nairaTick(1_250_000_000)).toBe('₦12.5M');
  });

  it('rounds to the naira before shortening, so a figure never reads as the next unit up by accident', () => {
    // ₦999,999.60 is ₦1,000,000 once rounded, and is drawn as such.
    expect(nairaTick(99_999_960)).toBe('₦1M');
    expect(nairaTick(99_949)).toBe('₦999');
  });
});
