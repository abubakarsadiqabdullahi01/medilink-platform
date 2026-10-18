'use client';

import { useEffect, useState } from 'react';

/**
 * The current time, refreshed on an interval, with no request behind it.
 *
 * A screen that works out "starts in 36 minutes" or "check-in is open" once, at render, is wrong
 * a minute later and stays wrong until something else makes it draw again — which on a screen left
 * open in a ward office is hours. This redraws what depends on the clock, and nothing else.
 * It stops while the tab is hidden, so it costs nothing in a pocket.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      setNow(new Date());
      timer = setInterval(() => setNow(new Date()), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.hidden ? stop() : (stop(), start()));

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return now;
}
