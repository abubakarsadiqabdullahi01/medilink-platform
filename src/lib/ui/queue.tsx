'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/ui/api';

/**
 * Loading a queue, and the three states every one of them has.
 *
 * Written once because all seven queues are the same shape: fetch a list,
 * show a spinner, show an error, act on a row, reload. A page that repeated
 * this would be six-sevenths boilerplate and the seventh would be the bug.
 */
export interface Queue<T> {
  rows: T[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Runs an action, then reloads. Errors surface on the queue, not the console. */
  act: (run: () => Promise<unknown>) => Promise<boolean>;
  busy: boolean;
}

export function useQueue<T>(path: string, pick: (body: never) => T[]): Queue<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(path)
      .then((body) => {
        if (!cancelled) {
          setRows(pick(body as never));
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Could not load this queue.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `pick` is inline at every call site and would re-run this forever as a
    // dependency; the path is what actually identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce]);

  const act = useCallback(
    async (run: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await run();
        reload();
        return true;
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'That did not work.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  return { rows, loading, error, reload, act, busy };
}
