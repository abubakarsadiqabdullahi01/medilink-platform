'use client';

import { useEffect } from 'react';

/**
 * Names the browser tab, the history entry and the screen-reader page-change announcement after
 * the page, not after the product (WCAG 2.4.2). Every page used to be titled "Medilink", which
 * is no help to an officer with four queues open in four tabs.
 *
 * It is a client component because the pages are: they cannot export `metadata`. The HTML a
 * browser first receives still says "Medilink"; this sets the real title as soon as the page runs.
 */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = `${title} · Medilink`;
  }, [title]);
  return null;
}
