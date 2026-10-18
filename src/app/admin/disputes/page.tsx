'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Gavel, Search } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { formatAgo, formatWhen } from '@/components/app/format';
import { cn } from '@/lib/utils';
import { ScreenTransition } from '@/components/app/motion';
import { DisputeDetail, type Dispute } from './dispute-detail';

// [value, label] rather than the OPEN/UNDER_REVIEW pair the queue used to be
// hard-wired to: a case resolved last month used to be unreachable from this
// screen the moment it left the live set, the same gap step 7.7's queue had
// before `listUnhonoured` closed it.
const STATUSES = [
  ['OPEN', 'Open'],
  ['UNDER_REVIEW', 'Under review'],
  ['RESOLVED', 'Resolved'],
  ['WITHDRAWN', 'Withdrawn'],
] as const;

const PAGE_SIZE = 20;

/**
 * Disputes — module 14. The queue; one case is `dispute-detail.tsx`.
 *
 * The list used to carry the adjudication too: every row expanded into a
 * textarea and three buttons, so a page of twenty cases was twenty open
 * forms. Worse, the evidence was nowhere — both sides attach photographs and
 * letters, and the screen that decides the case never showed them.
 *
 * A row is now a summary and a click, and deciding happens on its own screen
 * with the attachments in front of it.
 */
export default function DisputesPage() {
  const [status, setStatus] = useState<string>('OPEN');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [selected, setSelected] = useState<Dispute | null>(null);

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const queueKey = ['disputes', status, applied];
  const queue = useQuery({
    queryKey: [...queueKey, cursor],
    queryFn: () => {
      const parts = [
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        applied ? `search=${encodeURIComponent(applied)}` : '',
        cursor ? `cursor=${cursor}` : '',
      ].filter(Boolean);
      return api.get<{ disputes?: Dispute[]; nextCursor?: string | null }>(
        `/api/v1/disputes?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  const rows = queue.data?.disputes ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;

  if (selected) {
    return (
      <ScreenTransition screenKey={selected.id}>
        <DisputeDetail dispute={selected} onBack={() => setSelected(null)} />
      </ScreenTransition>
    );
  }

  return (
    <>
      <PageHeader
        title="Disputes"
        description="A shift the two sides disagree about, after it was decided. You decide who was right; the facility then corrects the timesheet through the ordinary route, so the change is visible in the revisions."
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
              <Label htmlFor="dispute-search">Search by practitioner or facility</Label>
              <Input
                id="dispute-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ngozi, or Ibadan University Hospital"
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
        <QueueSkeleton />
      ) : queue.isError ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Gavel />}
          title={applied ? 'Nothing matches that' : `No ${humanise(status).toLowerCase()} cases`}
          description={applied ? 'Try part of a practitioner or facility name.' : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const open = row.status === 'OPEN' || row.status === 'UNDER_REVIEW';

            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  className={cn(
                    'w-full rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    row.status === 'OPEN' && 'border-warning/40',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <Gavel className="size-5" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{row.practitionerName}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.facilityName} · shift {formatWhen(row.shiftStartsAt)}
                      </p>
                      {/* One line of the reason. The whole of it is a click
                          away, and a queue of full paragraphs is a queue
                          nobody scans. */}
                      <p className="mt-1 truncate text-sm text-muted-foreground">{row.reason}</p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Badge variant={row.raisedParty === 'PRACTITIONER' ? 'info' : 'warning'}>
                        {row.raisedParty === 'PRACTITIONER' ? 'Practitioner' : 'Facility'}
                      </Badge>
                      <Badge variant="secondary">{humanise(row.category)}</Badge>
                      {open ? (
                        <span className="text-xs text-muted-foreground">
                          {formatAgo(row.createdAt)}
                        </span>
                      ) : null}
                      <StatusBadge status={row.status} />
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
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
