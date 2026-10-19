import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePointerPressing } from './pointer-pressing';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const fire = (type: string) =>
  act(() => void document.dispatchEvent(new Event(type, { bubbles: true })));

describe('usePointerPressing', () => {
  it('is false until a pointer goes down', () => {
    const { result } = renderHook(() => usePointerPressing());
    expect(result.current).toBe(false);
  });

  it('is true while the pointer is down and a moment after it is released', () => {
    const { result } = renderHook(() => usePointerPressing());
    fire('pointerdown');
    expect(result.current).toBe(true);

    fire('pointerup');
    // Still held: the click follows the release, and a touch screen presses again after it.
    expect(result.current).toBe(true);

    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBe(false);
  });

  it('stays pressing when a second press arrives before the release has settled', () => {
    const { result } = renderHook(() => usePointerPressing());
    fire('pointerdown');
    fire('pointerup');
    act(() => void vi.advanceTimersByTime(40));
    fire('pointerdown');
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBe(true);
    fire('pointerup');
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBe(false);
  });

  it('treats a cancelled pointer as released', () => {
    const { result } = renderHook(() => usePointerPressing());
    fire('pointerdown');
    fire('pointercancel');
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBe(false);
  });
});
