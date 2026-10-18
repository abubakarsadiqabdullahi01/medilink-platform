'use client';

import { useCallback, useState } from 'react';

/**
 * Previous and next over a list the API pages by cursor.
 *
 * The API hands back only "the cursor for the page after this one", so going back means
 * remembering the cursors already seen. Every queue had its own copy of this — two arrays and
 * three handlers — with the same off-by-one waiting in each. `startOver` is for a filter change:
 * a cursor belongs to the filters that produced it.
 */
export function useCursorPager() {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);

  const startOver = useCallback(() => {
    setCursors([null]);
    setPageIndex(0);
  }, []);

  const goPrevious = useCallback(() => setPageIndex((index) => Math.max(0, index - 1)), []);

  const goNext = useCallback(
    (nextCursor: string | null | undefined) => {
      if (!nextCursor) return;
      setCursors((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
      setPageIndex((index) => index + 1);
    },
    [pageIndex],
  );

  return {
    cursor: cursors[pageIndex] ?? null,
    pageIndex,
    startOver,
    goPrevious,
    goNext,
  };
}
