'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ScreenTransition } from '@/components/app/motion';
import { formatAgo, formatWhen } from '@/components/app/format';
import { RequestDetail, type SubjectRequest } from './request-detail';

/**
 * Data-subject requests: somebody exercising a right over their own record.
 *
 * Ordered by deadline rather than arrival, because the Act gives a month and
 * the one closest to running out is the one to work. The list says how long is
 * left rather than only when it is due — "four days left" is the number an
 * officer acts on; a date is one they have to subtract from.
 */

const STATUSES = [
  ['RECEIVED', 'Received'],
  ['IN_PROGRESS', 'In progress'],
  ['COMPLETED', 'Completed'],
  ['REFUSED', 'Refused'],
] as const;

const KINDS = ['ACCESS', 'RECTIFICATION', 'ERASURE', 'PORTABILITY', 'RESTRICTION'] as const;

const PAGE_SIZE = 20;

/** Whole days remaining, negative once the deadline has passed. */
function daysLeft(dueBy: string): number {
  return Math.ceil((new Date(dueBy).getTime() - Date.now()) / 86_400_000);
}

export default function DataRequestsPage() {
  const [status, setStatus] = useState<string>('RECEIVED');
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [selected, setSelected] = useState<SubjectRequest | null>(null);

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const queue = useQuery({
    queryKey: ['request-queue', status, kind, applied, cursor],
    queryFn: () => {
      const parts = [
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        kind !== 'all' ? `kind=${kind}` : '',
        applied ? `search=${encodeURIComponent(applied)}` : '',
        cursor ? `cursor=${cursor}` : '',
      ].filter(Boolean);
      return api.get<{ requests?: SubjectRequest[]; nextCursor?: string | null }>(
        `/api/v1/data-requests?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  if (selected) {
    return (
      <ScreenTransition screenKey={selected.id}>
        <RequestDetail request={selected} onBack={() => setSelected(null)} />
      </ScreenTransition>
    );
  }

  const rows = queue.data?.requests ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;
  const overdue = rows.filter((row) => row.overdue).length;
  const filtered = kind !== 'all' || Boolean(applied);

  return (
    <>
      <PageHeader
        title="Data requests"
        description="Somebody exercising a right over their own data. The Act expects an answer within a month, so this queue is ordered by deadline rather than by arrival."
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
              <Label htmlFor="request-search">Search by subject</Label>
              <Input
                id="request-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Their name, or the number they registered with"
              />
            </div>

            <div className="min-w-[170px] space-y-1.5">
              <Label>Right</Label>
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(value);
                  startOver();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any right</SelectItem>
                  {KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {humanise(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" loading={queue.isFetching}>
              <Search />
              Search
            </Button>

            {filtered ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setApplied('');
                  setKind('all');
                  startOver();
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>

          {!queue.isPending && rows.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {rows.length} on this page
              {overdue > 0 ? (
                <span className="font-medium text-destructive"> · {overdue} past the deadline</span>
              ) : null}
            </p>
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
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>This queue could not be loaded.</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title={filtered ? 'Nothing matches that' : 'Nothing waiting'}
          description={
            filtered
              ? 'Try a different right, or clear the filters.'
              : 'Every request has been answered within its month.'
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const left = daysLeft(row.dueBy);
            const open = row.status === 'RECEIVED' || row.status === 'IN_PROGRESS';

            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  className={cn(
                    'w-full rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    row.overdue && 'border-destructive/40',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                      <ShieldCheck className="size-5" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{row.subjectName}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {humanise(row.kind)} · received {formatAgo(row.receivedAt)}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        Due {formatWhen(row.dueBy)}
                      </p>
                    </div>

                    {/* The clock is the point of this queue, so it reads as a
                        countdown rather than a date somebody has to subtract. */}
                    {open ? (
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-1 text-xs font-medium',
                          row.overdue
                            ? 'bg-destructive/10 text-destructive'
                            : left <= 7
                              ? 'bg-warning/10 text-warning'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {row.overdue
                          ? `${Math.abs(left)} days over`
                          : left === 0
                            ? 'Due today'
                            : `${left} days left`}
                      </span>
                    ) : null}

                    <StatusBadge status={row.status} />
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
