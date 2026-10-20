import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatAgo } from '@/components/app/format';

/**
 * The two pieces every console's first screen is made of: one sentence that says how today is,
 * and a few numbers that each lead to the list behind them.
 *
 * A dashboard answers "what needs me now?" before anything else. The sentence comes first because
 * a count of zero and a count that failed to load look the same in a tile, and only a sentence can
 * tell them apart; the tiles come second and are the way in to the work.
 */

/**
 * One number that opens the list behind it.
 *
 * Three states, never two. A failed fetch is not zero — "nothing is waiting on you" and "we could
 * not find out" are opposites, and only one is safe to act on — so `isError` is its own look, and
 * `isPending` keeps the tile's shape rather than collapsing, so the page does not jump when the
 * number arrives.
 *
 * `value` is a number for a count and a short string for a time ("18 Oct, 10:00"); `note` is the
 * line that makes the number mean something, such as how long the oldest item has waited.
 */
export function StatTile({
  href,
  icon: Icon,
  label,
  value,
  hint,
  note,
  stale = false,
  display,
  isPending = false,
  isError = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: number | string;
  hint?: string;
  note?: ReactNode;
  /** Something here has waited too long: the tile says so with its edge, not only its words. */
  stale?: boolean;
  /** `figure` is the big number; `text` is for a time or a phrase. Counts default to a figure, strings to text. */
  display?: 'figure' | 'text';
  isPending?: boolean;
  isError?: boolean;
}) {
  const quiet = value === 0;

  return (
    <Link
      href={href}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card
        className={cn(
          'h-full transition-[border-color,box-shadow] duration-fast hover:border-primary/50 hover:shadow-raised',
          stale && 'border-warning/40',
        )}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <ArrowRight
              className="size-4 text-muted-foreground opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            />
          </div>

          <p className="mt-4 text-sm font-medium">{label}</p>

          {isPending ? (
            <Skeleton className="mt-2 h-9 w-16" />
          ) : isError ? (
            <p className="mt-2 text-sm text-destructive-text">Could not load</p>
          ) : (
            <p
              className={cn(
                'tabular mt-1 font-semibold',
                (display ?? (typeof value === 'number' ? 'figure' : 'text')) === 'figure'
                  ? 'text-3xl'
                  : 'text-xl leading-9',
                quiet && 'text-muted-foreground',
              )}
            >
              {value}
            </p>
          )}

          {!isPending && !isError && note ? (
            <p className={cn('mt-1 text-xs', stale ? 'font-medium text-warning' : 'text-muted-foreground')}>
              {note}
            </p>
          ) : null}

          {hint ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * The headline: how many things are waiting on this person, and how long the longest has waited.
 *
 * The oldest item is the honest measure of whether today is bad. Eleven items that arrived this
 * morning is an ordinary start; one that arrived nine days ago is somebody who has stopped
 * expecting an answer.
 *
 * Renders nothing while loading, on a failure, and when nothing is waiting: the page's own
 * description says "all clear", and a banner announcing zero is noise.
 */
export function NeedsBanner({
  count,
  oldest,
  noun = 'thing',
  ready,
}: {
  count: number;
  /** ISO time of the oldest waiting item, if known. */
  oldest?: string | null;
  noun?: string;
  /** False while loading or after a failure: no sentence is better than a wrong one. */
  ready: boolean;
}) {
  if (!ready || count === 0) return null;

  return (
    <Card className="border-primary/25 bg-accent/40">
      <CardContent className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-6 text-sm">
        <span className="tabular text-2xl font-semibold leading-none">{count}</span>
        <span className="font-medium">
          {count === 1 ? `${noun} is` : `${noun}s are`} waiting on you
        </span>
        {oldest ? (
          <span className="text-muted-foreground">
            · the oldest arrived {formatAgo(new Date(oldest).toISOString())}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
