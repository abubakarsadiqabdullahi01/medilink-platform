'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { CircleAlert, Lock, SearchX, ServerCrash, WifiOff, type LucideIcon } from 'lucide-react';
import { ApiError } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/app/page-shell';

/**
 * What a screen says when it could not show what it was asked to.
 *
 * "Nothing here", "you may not see this", "we could not find out" and "the server is
 * having a bad day" are four different facts that call for four different next steps,
 * and a blank card or a generic "Something went wrong" collapses them into one. A person
 * clearing a queue who is told there is nothing when there was a network blip will go home
 * with work undone.
 */

export type ErrorKind = 'forbidden' | 'not-found' | 'signed-out' | 'network' | 'server' | 'unknown';

export interface ErrorDescription {
  kind: ErrorKind;
  title: string;
  description: string;
  /** Trying again can help. For a refusal it never will. */
  retryable: boolean;
}

export function describeError(error: unknown): ErrorDescription {
  if (error instanceof ApiError) {
    const { status, message } = error.failure;
    if (status === 401) {
      return {
        kind: 'signed-out',
        title: 'You have been signed out',
        description:
          'Sign in again to carry on. Nothing you were doing has been lost on the server.',
        retryable: false,
      };
    }
    if (status === 403) {
      return {
        kind: 'forbidden',
        title: 'You do not have access to this',
        description:
          message ||
          'Your account does not have the permission this needs. If you think it should, ask the person who manages access for you.',
        retryable: false,
      };
    }
    if (status === 404) {
      return {
        kind: 'not-found',
        title: 'We could not find that',
        description: 'It may have been removed, or the link may be out of date.',
        retryable: false,
      };
    }
    if (status >= 500) {
      return {
        kind: 'server',
        title: 'Medilink had a problem',
        description:
          'This is on our side, not yours, and nothing you entered was lost. Try again in a moment; if it keeps happening, contact support.',
        retryable: true,
      };
    }
    return {
      kind: 'unknown',
      title: 'That did not work',
      description: message || 'Something went wrong.',
      retryable: true,
    };
  }
  // fetch() rejects with a TypeError when there is no connection at all.
  if (
    error instanceof TypeError ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return {
      kind: 'network',
      title: 'Could not reach Medilink',
      description:
        'Check your connection and try again. This is a connection problem, not an empty list — nothing has changed.',
      retryable: true,
    };
  }
  return {
    kind: 'unknown',
    title: 'Something went wrong',
    description: 'Try again in a moment.',
    retryable: true,
  };
}

const ICON: Record<ErrorKind, LucideIcon> = {
  forbidden: Lock,
  'not-found': SearchX,
  'signed-out': Lock,
  network: WifiOff,
  server: ServerCrash,
  unknown: CircleAlert,
};

/**
 * A failed load, in the page's own place. The console around it stays up: a failed request
 * replaces one panel, never the screen.
 */
export function ErrorState({
  error,
  onRetry,
  retrying = false,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  const info = describeError(error);
  const Icon = ICON[info.kind];

  return (
    <Card
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 text-center ${compact ? 'px-5 py-8' : 'px-6 py-14'} ${
        info.kind === 'forbidden' || info.kind === 'not-found'
          ? 'border-dashed shadow-none'
          : 'border-destructive/30'
      }`}
    >
      <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="font-medium">{info.title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
          {info.description}
        </p>
      </div>
      {info.kind === 'signed-out' ? (
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      ) : info.retryable && onRetry ? (
        <Button variant="outline" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      ) : null}
    </Card>
  );
}

/** The honest empty state for a filtered list: it names the cause and offers the way out. */
export function FilteredEmpty({
  noun,
  onClear,
  activeCount,
}: {
  noun: string;
  onClear: () => void;
  activeCount: number;
}) {
  return (
    <EmptyState
      icon={<SearchX />}
      title={`No ${noun} match ${activeCount === 1 ? 'this filter' : 'these filters'}`}
      description="There may be some that the filters are hiding. Clearing them shows everything."
      action={
        <Button variant="outline" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}

/**
 * Loading, said to everyone. The shapes are for the eye; the status line is for a screen
 * reader, which otherwise meets a page of hidden skeletons and no word of what is happening.
 */
export function LoadingStatus({ label = 'Loading' }: { label?: string }) {
  return (
    <p role="status" className="sr-only">
      {label}…
    </p>
  );
}

export function ListSkeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <LoadingStatus label={label} />
      {Array.from({ length: rows }).map((_, index) => (
        <Card key={index} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="w-full space-y-2.5">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton className="h-6 w-20 shrink-0" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function TableSkeleton({
  rows = 5,
  columns = 4,
  label = 'Loading',
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  return (
    <Card className="overflow-hidden" aria-busy="true">
      <LoadingStatus label={label} />
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, row) => (
          <div key={row} className="flex items-center gap-6 p-4">
            {Array.from({ length: columns }).map((__, column) => (
              <Skeleton key={column} className={`h-4 ${column === 0 ? 'w-1/4' : 'w-1/6'}`} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Shown while a refetch is under way and rows are already on screen. */
export function RefreshingNote({ active, children }: { active: boolean; children?: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className="h-5 text-sm text-muted-foreground">
      {active ? (children ?? 'Updating…') : ''}
    </p>
  );
}
