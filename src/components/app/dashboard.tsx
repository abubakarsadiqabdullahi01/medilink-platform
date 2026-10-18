'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The furniture of a dashboard, shared by the three consoles.
 *
 * Each dashboard answers the same four questions in the same order — what needs me, how
 * are we doing, what is coming, where do I go to do the work — and the answers used to be
 * drawn three different ways. These are the pieces, so a tile means the same thing whoever
 * is looking at it.
 */

export type Tone = 'neutral' | 'warning' | 'danger' | 'success';

const TONE_MARK: Record<
  Tone,
  { icon: LucideIcon | null; className: string; border: string; word: string }
> = {
  neutral: { icon: null, className: 'text-muted-foreground', border: '', word: '' },
  success: { icon: CircleCheck, className: 'text-success', border: '', word: 'On track. ' },
  warning: {
    icon: TriangleAlert,
    className: 'text-warning',
    border: 'border-warning/50',
    word: 'Needs attention. ',
  },
  danger: {
    icon: CircleAlert,
    className: 'text-destructive-text',
    border: 'border-destructive/50',
    word: 'Urgent. ',
  },
};

/** Three to five tiles in a row, wrapping by the room they have rather than by the screen. */
export function MetricGrid({
  children,
  className,
  compact = false,
}: {
  children: ReactNode;
  className?: string;
  /** Narrower tiles, so a phone shows two across: for four short figures, not for sentences. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'grid gap-3 sm:gap-4',
        // Compact is two across until there is room for four, not "as many as fit": four
        // squeezed tiles at 1024px each held a seven-figure amount in 133px.
        compact
          ? 'grid-cols-2 xl:grid-cols-4'
          : '[grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One number and what it counts.
 *
 * The tone is carried by a mark and by a word read aloud, never by the border alone. With
 * `href` the whole tile is the link — one real anchor stretched over the card, so the target
 * is the size of the tile and a keyboard user lands on one stop, not on a card and a link.
 */
export function MetricTile({
  label,
  value,
  hint,
  href,
  tone = 'neutral',
  icon,
  loading = false,
  error = false,
  compact = false,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: Tone;
  icon?: LucideIcon;
  loading?: boolean;
  /** A failed fetch is not zero, and must not look like it. */
  error?: boolean;
  /** For a tile in a two-across grid on a phone. */
  compact?: boolean;
  className?: string;
}) {
  const mark = TONE_MARK[tone];
  const Icon = mark.icon ?? icon;

  const heading = (
    <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      {Icon ? <Icon className={cn('size-4 shrink-0', mark.className)} aria-hidden="true" /> : null}
      <span className="min-w-0">{label}</span>
    </span>
  );

  return (
    <Card
      className={cn(
        'relative flex flex-col gap-1.5',
        compact ? 'p-4' : 'p-5',
        className,
        mark.border,
        href && 'transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-accent/40',
      )}
    >
      {href ? (
        <Link
          href={href}
          className="flex items-center justify-between gap-2 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          {heading}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : (
        heading
      )}

      {loading ? (
        <Skeleton className="h-9 w-20" />
      ) : error ? (
        <p className="flex items-center gap-1.5 text-sm text-destructive-text">
          <CircleAlert className="size-4" aria-hidden="true" /> Could not load
        </p>
      ) : (
        <p
          className={cn(
            'tabular font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]',
            compact ? 'text-2xl' : 'text-3xl',
          )}
        >
          <span className="sr-only">{mark.word}</span>
          {value}
        </p>
      )}
      {hint && !loading ? (
        <p className="text-sm leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}

export interface AttentionItem {
  id: string;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  detail?: ReactNode;
  href: string;
  /** What the click does, in a verb: "Review", "Answer", "Approve". */
  action: string;
}

const ATTENTION: Record<AttentionItem['tone'], { icon: LucideIcon; chip: string; word: string }> = {
  danger: { icon: CircleAlert, chip: 'bg-destructive/10 text-destructive-text', word: 'Urgent' },
  warning: { icon: TriangleAlert, chip: 'bg-warning/15 text-warning', word: 'Needs attention' },
  info: { icon: Info, chip: 'bg-info/10 text-info', word: 'For your information' },
};

/**
 * "Attention required": the short list of things that will go wrong if nobody acts, most
 * urgent first, each one click from the place it is dealt with.
 *
 * It says so plainly when there is nothing. An empty list that is a blank rectangle reads
 * as "still loading" or "broken"; a tick and a sentence reads as "you are done".
 */
export function AttentionList({
  title = 'Needs your attention',
  items,
  loading = false,
  error = false,
  emptyTitle = 'Nothing needs your attention',
  emptyDetail,
  limit = 5,
}: {
  title?: string;
  items: AttentionItem[];
  loading?: boolean;
  error?: boolean;
  emptyTitle?: string;
  emptyDetail?: string;
  /**
   * How many to show before "Show all". The list is most urgent first, so the cut hides the least
   * urgent; without one, a busy day pushed everything else on the page below the fold on a phone.
   */
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <section aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="mb-3 text-lg font-semibold tracking-tight">
        {title}
        {!loading && !error && items.length > 0 ? (
          <span className="tabular ml-2 text-base font-normal text-muted-foreground">
            ({items.length})
          </span>
        ) : null}
      </h2>

      {loading ? (
        <Card className="divide-y">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3 p-4">
              <Skeleton className="size-9 rounded-full" />
              <div className="w-full space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </Card>
      ) : error ? (
        <Card className="flex items-start gap-3 border-destructive/40 p-4">
          <CircleAlert
            className="mt-0.5 size-5 shrink-0 text-destructive-text"
            aria-hidden="true"
          />
          <p className="text-sm leading-relaxed">
            The list of things that need you could not be loaded. That is not the same as there
            being nothing — try again in a moment.
          </p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex items-start gap-3 p-4">
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
          <div>
            <p className="font-medium">{emptyTitle}</p>
            {emptyDetail ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{emptyDetail}</p>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y">
            {shown.map((item) => {
              const mark = ATTENTION[item.tone];
              const Icon = mark.icon;
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="group flex min-h-16 items-center gap-3 p-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-full',
                        mark.chip,
                      )}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-snug">
                        <span className="sr-only">{mark.word}: </span>
                        {item.title}
                      </span>
                      {item.detail ? (
                        <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                          {item.detail}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                      <span className="hidden sm:inline">{item.action}</span>
                      <ArrowRight className="size-4" aria-hidden="true" />
                      <span className="sr-only sm:hidden">{item.action}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {items.length > limit ? (
            <div className="border-t px-4 py-2">
              <button
                type="button"
                aria-expanded={all}
                onClick={() => setAll((value) => !value)}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {all ? 'Show fewer' : `Show all ${items.length}`}
              </button>
            </div>
          ) : null}
        </Card>
      )}
    </section>
  );
}

/** A titled block of a dashboard with its way into the full list. */
export function DashboardSection({
  id,
  title,
  description,
  href,
  hrefLabel = 'View all',
  children,
}: {
  id: string;
  title: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {href ? (
          <Link
            href={href}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {hrefLabel} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}
