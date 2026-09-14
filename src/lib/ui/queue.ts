'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/ui/api';

/**
 * A queue and the actions taken on it.
 *
 * Every queue in the console is the same shape — fetch a list, act on a row,
 * refetch — so it is written once. What differs between pages is what a row
 * looks like and which buttons it has, which is the part worth writing by
 * hand.
 *
 * **One key, one shape.** What goes under a query key is the unwrapped list,
 * never the `{ things: [...] }` envelope the API returns. A plain `useQuery`
 * elsewhere that caches the envelope under a key this helper also uses will
 * not fail where it is written: whichever page renders first wins the cache,
 * and the other one throws `.filter is not a function` — on the page that did
 * nothing wrong. Unwrap at the boundary, every time.
 */
export function useQueue<T>(key: unknown[], path: string, pick: (body: unknown) => T[]) {
  return useQuery({
    queryKey: key,
    queryFn: async () => pick(await api.get(path)),
  });
}

/**
 * An action on a queue row.
 *
 * Success invalidates the queue *and* the dashboard tiles, because a
 * dashboard still showing "3 to verify" after you verified one is a dashboard
 * nobody believes. Failure surfaces as a toast rather than as a banner: the
 * card is still there and still says what it said, so the message belongs
 * next to the click.
 */
export function useQueueAction<TVariables>(options: {
  queueKey: unknown[];
  run: (variables: TVariables) => Promise<unknown>;
  success: string | ((variables: TVariables) => string);
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: options.run,
    onSuccess: (_data, variables) => {
      toast.success(
        typeof options.success === 'function' ? options.success(variables) : options.success,
      );
      void queryClient.invalidateQueries({ queryKey: options.queueKey });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
    },
    onError: (error) => {
      toast.error('That did not work', { description: errorMessage(error) });
    },
  });
}

export { api };
