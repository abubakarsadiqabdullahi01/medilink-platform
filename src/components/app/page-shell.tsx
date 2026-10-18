import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TriangleAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-h1">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/**
 * Empty is a design state, not an absence.
 *
 * "Nothing waiting" and "this failed to load" look identical if the empty
 * case is a blank area, and the difference matters enormously to somebody
 * whose job is to clear a queue.
 */
export function EmptyState({
  icon,
  title,
  description,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** For a list that sits under a form on the same page, where a tall empty box pushes the next step off screen. */
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        'flex flex-col items-center justify-center gap-3 border-dashed text-center shadow-none',
        compact ? 'py-8' : 'py-16',
      )}
    >
      {icon ? <div className="text-muted-foreground [&_svg]:size-8">{icon}</div> : null}
      <div>
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * The third state of every list, beside loading and empty: it did not arrive.
 *
 * Said the same way everywhere — what could not be loaded, then a way to try again — because
 * on a weak connection this is a screen people meet weekly, and a bare "could not be
 * loaded" with no next step sends them to support for something a second tap would fix.
 * It is announced, since it appears because something went wrong.
 */
export function ErrorState({
  message,
  onRetry,
  retrying = false,
}: {
  /** What did not arrive, as a sentence: "Your offers could not be loaded." */
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Alert variant="destructive">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/** Cards the shape of the cards that are coming, not a spinner. */
export function QueueSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, index) => (
        <Card key={index} className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="w-full space-y-2.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-20 shrink-0" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** A labelled value, used everywhere a record is summarised. */
export function Detail({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

export function DetailGrid({ children }: { children: ReactNode }) {
  // Sized by the card it is in, not by the screen: `lg:grid-cols-4` counted
  // the viewport, so a card that shares a row with another (half the width)
  // was still cut into four columns and cramped. Auto-fit asks each column for
  // at least 9rem and lets the card decide how many fit.
  return (
    <dl className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
      {children}
    </dl>
  );
}
