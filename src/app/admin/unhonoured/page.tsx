'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileClock, Search } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { ScreenTransition } from '@/components/app/motion';
import { formatAgo } from '@/components/app/format';
import { UnhonouredDetail, type Unhonoured } from './unhonoured-detail';

/**
 * Shifts that ended with nothing to show for them.
 *
 * A sweep flags; a person decides. Nothing ages out of here on its own,
 * because an absence has a dozen innocent explanations and the platform cannot
 * tell them apart from a database row.
 *
 * Decided flags are reachable now. The queue showed only what was awaiting a
 * decision, so there was no way to see what had been decided about a shift
 * last month — a poor property for the record of who was held answerable for
 * somebody not turning up.
 */

const STATUSES = [
  ['AWAITING_DECISION', 'Awaiting decision'],
  ['CLOSED', 'Decided'],
] as const;

const PAGE_SIZE = 20;

export default function UnhonouredPage() {
  const [status, setStatus] = useState<string>('AWAITING_DECISION');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [selected, setSelected] = useState<Unhonoured | null>(null);

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const queue = useQuery({
    queryKey: ['unhonoured-queue', status, applied, cursor],
    queryFn: () => {
      const parts = [
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        applied ? `search=${encodeURIComponent(applied)}` : '',
        cursor ? `cursor=${cursor}` : '',
      ].filter(Boolean);
      return api.get<{ unhonoured?: Unhonoured[]; nextCursor?: string | null }>(
        `/api/v1/unhonoured?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  if (selected) {
    return (
      <ScreenTransition screenKey={selected.id}>
        <UnhonouredDetail record={selected} onBack={() => setSelected(null)} />
      </ScreenTransition>
    );
  }

  const rows = queue.data?.unhonoured ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;

  return (
    <>
      <PageHeader
        title="Unhonoured shifts"
        description="A shift that ended with no sign of anybody attending. An absence has a dozen innocent explanations and the platform cannot tell them apart — so nothing here closes until a person says whose fault it was."
      />

      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value);
          startOver();
        }}
        className="mb-5"
      >
        <TabsList>
          {STATUSES.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(search.trim());
              startOver();
            }}
          >
            <div className="min-w-[240px] flex-1 space-y-1.5">
              <Label htmlFor="unhonoured-search">Search by practitioner or facility</Label>
              <Input
                id="unhonoured-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Adaeze, or Owerri General"
              />
            </div>

            <Button type="submit" loading={queue.isFetching}>
              <Search />
              Search
            </Button>

            {applied ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setApplied('');
                  startOver();
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>

          {!queue.isPending && rows.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">{rows.length} on this page</p>
          ) : null}
        </CardContent>
      </Card>

      {queue.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : queue.isError ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FileClock />}
          title={
            applied
              ? 'Nothing matches that'
              : status === 'AWAITING_DECISION'
                ? 'Nothing awaiting a decision'
                : 'Nothing decided yet'
          }
          description={
            applied
              ? 'Try part of a practitioner or facility name.'
              : status === 'AWAITING_DECISION'
                ? 'Every flagged shift has had somebody answer for it.'
                : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => setSelected(row)}
                className="w-full rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <FileClock className="size-5" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.practitionerName}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {row.facilityName}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      Shift ended {formatAgo(row.shiftEndedAt)} · flagged{' '}
                      {formatAgo(row.detectedAt)}
                    </p>
                  </div>

                  {row.fault ? (
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {humanise(row.fault)} at fault
                    </span>
                  ) : null}

                  <StatusBadge status={row.status} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 && (pageIndex > 0 || nextCursor) ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pageIndex === 0 || queue.isFetching}
            onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
          >
            <ChevronLeft />
            Previous
          </Button>

          <p className="tabular text-xs text-muted-foreground">
            Page {pageIndex + 1}
            {queue.isFetching ? ' · loading' : ''}
          </p>

          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor || queue.isFetching}
            onClick={() => {
              if (!nextCursor) return;
              setCursors((current) => {
                const next = current.slice(0, pageIndex + 1);
                next.push(nextCursor);
                return next;
              });
              setPageIndex((index) => index + 1);
            }}
          >
            Next
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </>
  );
}
