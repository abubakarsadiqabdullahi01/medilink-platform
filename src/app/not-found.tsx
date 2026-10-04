import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The App Router's own 404.
 *
 * Its absence was a build failure, not a missing nicety: with no
 * `not-found.tsx` Next falls back to the pages-router error template, which
 * imports `<Html>`, and prerendering `/404` then fails the production build
 * outright. The app could be developed and never shipped.
 *
 * It offers the way back rather than only the bad news. Somebody who has
 * mistyped a console URL wants the console, and which console is theirs is
 * decided by their grants — so this links to the root, which already routes
 * a signed-in person to the right one.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <FileQuestion className="size-6" aria-hidden="true" />
        </span>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight">This page does not exist</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The address may have been mistyped, or the record may have been moved. Nothing has gone
          wrong with your account.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/">Back to Medilink</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
