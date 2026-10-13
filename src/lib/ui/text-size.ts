/**
 * The reader's text size (UXA-04).
 *
 * The pilot's complaint was that the text was too small to read on a phone in
 * sunlight and across a room on a projector. Everything is sized in rem, so
 * scaling the root scales the page: one attribute on <html>, and the stylesheet
 * does the rest. Remembered on this device, because it is a fact about the
 * person's eyes and the screen in front of them, not about the account.
 */

export const TEXT_SIZES = ['normal', 'large', 'projector'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const TEXT_SIZE_KEY = 'medilink:text-size';

export function parseTextSize(value: unknown): TextSize {
  return TEXT_SIZES.find((size) => size === value) ?? 'normal';
}

export function readTextSize(): TextSize {
  try {
    return parseTextSize(window.localStorage.getItem(TEXT_SIZE_KEY));
  } catch {
    // Storage can be blocked outright; the page is still readable at its normal size.
    return 'normal';
  }
}

export function saveTextSize(size: TextSize): void {
  try {
    window.localStorage.setItem(TEXT_SIZE_KEY, size);
  } catch {
    // Private browsing: the choice still holds for this visit.
  }
}

/** Marks the page. Normal leaves it unmarked, so nothing changes for anybody who did not ask. */
export function applyTextSize(size: TextSize, root: HTMLElement = document.documentElement): void {
  if (size === 'normal') root.removeAttribute('data-text-size');
  else root.setAttribute('data-text-size', size);
}
