'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, without a flash.
 *
 * `serverValue` is what the HTML is rendered with. It should be the layout most of this
 * page's readers get: the console is mostly opened on a laptop, so the filter bar is
 * server-rendered as the wide one and a phone corrects it in the first client render,
 * before a queue has even loaded. `useSyncExternalStore` makes that correction a plain
 * re-render rather than a hydration mismatch.
 */
export function useMediaQuery(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
