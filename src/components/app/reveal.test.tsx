import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Reveal } from './reveal';

type Callback = (entries: { isIntersecting: boolean }[]) => void;
let callback: Callback | null = null;
let disconnected = false;

beforeEach(() => {
  callback = null;
  disconnected = false;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: Callback) {
        callback = cb;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  );
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function below(top: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top } as DOMRect);
}

describe('Reveal', () => {
  it('is visible to begin with, so nothing is hidden for a person whose scripts have not run', () => {
    const { container } = render(<Reveal>content</Reveal>);
    // Before any effect has run, which is what the server's HTML is.
    expect(container.firstElementChild).toHaveAttribute('data-reveal');
    expect(container.firstElementChild?.className).toContain('reveal');
  });

  it('leaves a section that is already in view alone', () => {
    below(100);
    const { container } = render(<Reveal>content</Reveal>);
    expect(container.firstElementChild).toHaveAttribute('data-reveal', 'visible');
  });

  it('hides a section below the fold, and shows it once, when it scrolls into view', () => {
    below(2000);
    const { container } = render(<Reveal>content</Reveal>);
    const section = container.firstElementChild!;
    expect(section).toHaveAttribute('data-reveal', 'hidden');

    act(() => callback?.([{ isIntersecting: true }]));
    expect(section).toHaveAttribute('data-reveal', 'shown');
    expect(disconnected).toBe(true);
  });

  it('does not hide anything for somebody who has asked for less motion', () => {
    below(2000);
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const { container } = render(<Reveal>content</Reveal>);
    expect(container.firstElementChild).toHaveAttribute('data-reveal', 'visible');
  });
});
