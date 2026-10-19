import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useCursorPager } from './cursor-pager';

afterEach(cleanup);

describe('useCursorPager', () => {
  it('starts on the first page, which has no cursor', () => {
    const { result } = renderHook(() => useCursorPager());
    expect(result.current.cursor).toBeNull();
    expect(result.current.pageIndex).toBe(0);
  });

  it('goes forward on the cursor the API gave and back to the one it remembered', () => {
    const { result } = renderHook(() => useCursorPager());

    act(() => result.current.goNext('c1'));
    expect(result.current).toMatchObject({ cursor: 'c1', pageIndex: 1 });

    act(() => result.current.goNext('c2'));
    expect(result.current).toMatchObject({ cursor: 'c2', pageIndex: 2 });

    act(() => result.current.goPrevious());
    expect(result.current).toMatchObject({ cursor: 'c1', pageIndex: 1 });

    act(() => result.current.goPrevious());
    expect(result.current).toMatchObject({ cursor: null, pageIndex: 0 });
  });

  it('does not go back past the first page', () => {
    const { result } = renderHook(() => useCursorPager());
    act(() => result.current.goPrevious());
    expect(result.current.pageIndex).toBe(0);
  });

  it('ignores a next with no cursor, which is how the last page ends', () => {
    const { result } = renderHook(() => useCursorPager());
    act(() => result.current.goNext(null));
    act(() => result.current.goNext(undefined));
    expect(result.current).toMatchObject({ cursor: null, pageIndex: 0 });
  });

  it('forgets cursors that belonged to a path the person has left', () => {
    const { result } = renderHook(() => useCursorPager());
    act(() => result.current.goNext('a1'));
    act(() => result.current.goPrevious());
    // A different second page than the one first seen: the old cursor must not come back.
    act(() => result.current.goNext('b1'));
    expect(result.current.cursor).toBe('b1');
    act(() => result.current.goPrevious());
    act(() => result.current.goNext('b1'));
    expect(result.current.cursor).toBe('b1');
  });

  it('starts over when the filters change, because a cursor belongs to the filters that made it', () => {
    const { result } = renderHook(() => useCursorPager());
    act(() => result.current.goNext('c1'));
    act(() => result.current.goNext('c2'));
    act(() => result.current.startOver());
    expect(result.current).toMatchObject({ cursor: null, pageIndex: 0 });
  });
});
