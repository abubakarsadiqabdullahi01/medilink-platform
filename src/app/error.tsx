'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * What a person sees when a page throws.
 *
 * Before this there was nothing, so an unhandled render error showed Next's
 * own stack trace in development and a blank page in production — on a
 * console where the alternative reading is "my account is broken".
 *
 * The digest is shown deliberately. It is the one string that ties what
 * somebody saw to the line in the server log, and an officer reporting a
 * fault with it saves an afternoon of guessing which page they meant. It
 * carries no detail of its own, which is why it is safe to show.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <TriangleAlert className="size-6" aria-hidden="true" />
        </span>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight">This page did not load</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Something failed while building the screen. Nothing you were working on has been changed.
        </p>

        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Reference {error.digest}
          </p>
        ) : null}

        <div className="mt-6 flex justify-center">
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </main>
  );
}
