'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { MotionProvider } from '@/components/app/motion';
import { ApiError } from '@/lib/ui/api';
import { timing } from '@/lib/ui/query-keys';

/**
 * React Query, configured for a console rather than for a content site.
 *
 * `retry` is off for anything the server refused on purpose. Retrying a 403
 * three times does not turn it into a 200; it just makes a queue feel broken
 * and puts three refusals in the audit log instead of one.
 *
 * The default staleness is a minute, not fifteen seconds. Fifteen was one
 * number standing in for every question the console asks, so stepping into a
 * queue and back refetched everything to render the same rows — and on a slow
 * connection that wait is the whole feeling of a sluggish console. Anything
 * that genuinely must be fresher says so at the call site with
 * `timing.live`; see query-keys.ts for the scale.
 *
 * `refetchOnWindowFocus` stays on but now defers to staleness, so alt-tabbing
 * back no longer refires every active query — only the ones actually past
 * their window.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: timing.interactive,
            gcTime: 10 * 60 * 1000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.failure.status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <MotionProvider>{children}</MotionProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
