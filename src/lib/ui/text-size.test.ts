import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TEXT_SIZE_KEY,
  applyTextSize,
  parseTextSize,
  readTextSize,
  saveTextSize,
} from './text-size';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-text-size');
  vi.restoreAllMocks();
});

describe('which text size somebody asked for', () => {
  it.each([
    ['large', 'large'],
    ['projector', 'projector'],
    ['normal', 'normal'],
  ])('keeps %s', (value, expected) => {
    expect(parseTextSize(value)).toBe(expected);
  });

  it.each([null, undefined, '', 'huge', 3, {}])('falls back to normal for %j', (value) => {
    expect(parseTextSize(value)).toBe('normal');
  });
});

describe('remembering it', () => {
  it('reads back what was saved', () => {
    saveTextSize('large');
    expect(window.localStorage.getItem(TEXT_SIZE_KEY)).toBe('large');
    expect(readTextSize()).toBe('large');
  });

  it('is normal when nothing was saved', () => {
    expect(readTextSize()).toBe('normal');
  });

  it('is normal, and does not throw, when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readTextSize()).toBe('normal');
    expect(() => saveTextSize('large')).not.toThrow();
  });
});

describe('applying it to the page', () => {
  it('marks the page, which the stylesheet scales from', () => {
    applyTextSize('projector');
    expect(document.documentElement.getAttribute('data-text-size')).toBe('projector');
  });

  it('leaves the page unmarked at normal, so nothing changes for anybody who did not ask', () => {
    applyTextSize('large');
    applyTextSize('normal');
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
  });
});
