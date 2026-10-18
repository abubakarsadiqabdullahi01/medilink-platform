import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export interface Crumb {
  label: string;
  /** Omitted on the page you are on. */
  href?: string;
}

/**
 * The top of every page, the same on all of them.
 *
 * `breadcrumbs` is for a page that is somewhere *inside* another — a shift inside Shifts, a
 * record inside a queue. On a wide screen it is the usual trail. On a phone a trail of three
 * wraps over two lines and each crumb is a thin target, so it becomes one large "back to"
 * link to the parent, which is what somebody standing in a corridor wants.
 *
 * `action` is the page's one primary action. A page with two competing primary buttons has
 * not decided what it is for.
 */
export function PageHeader({
  title,
  description,
  action,
  breadcrumbs,
  meta,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  breadcrumbs?: Crumb[];
  /** A status or a reference shown beside the title: a badge, a record number. */
  meta?: ReactNode;
}) {
  const parent = breadcrumbs && breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : undefined;

  return (
    <header className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <>
          {parent?.href ? (
            <Link
              href={parent.href}
              className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline sm:hidden"
            >
              <ArrowLeft className="size-4" aria-hidden="true" /> {parent.label}
            </Link>
          ) : null}
          <Breadcrumb className="mb-2 hidden sm:block">
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => {
                const last = index === breadcrumbs.length - 1;
                return (
                  <BreadcrumbItem key={`${crumb.label}-${index}`}>
                    {last || !crumb.href ? (
                      <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link href={crumb.href}>{crumb.label}</Link>
                      </BreadcrumbLink>
                    )}
                    {last ? null : <BreadcrumbSeparator />}
                  </BreadcrumbItem>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        </>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
            {meta}
          </div>
          {description ? (
            <p className="mt-1.5 max-w-3xl text-base leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
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
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** For a list that sits under a form on the same page, where a tall empty box pushes the next step off screen. */
  compact?: boolean;
  /** What to do about it: the first shift to publish, the filter to clear. */
  action?: ReactNode;
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
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </Card>
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
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
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
