'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, MessageSquareText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { formatAgo } from '@/components/app/format';
import { ScreenTransition } from '@/components/app/motion';
import { SuggestionDetail, type Suggestion } from './suggestion-detail';

interface AreaCount {
  area: string;
  total: number;
  open: number;
}

const STATUSES = ['NEW', 'TRIAGED', 'PLANNED', 'DONE', 'DECLINED'] as const;
const PAGE_SIZE = 20;

/**
 * The pilot's suggestion log — module 18.
 *
 * The one screen on this console where the list is the point: "where the
 * complaints are" is read by comparing areas at a glance, which is why the
 * bar chart stays here and leads. Answering an entry moved to its own screen
 * (`suggestion-detail.tsx`) — a page of twenty rows used to be twenty open
 * textareas, and a long suggestion was a paragraph squeezed into a card.
 */
export default function SuggestionsPage() {
  const [status, setStatus] = useState<string>('NEW');
  // Null means every area. Clicking a bar in "Where the complaints are"
  // narrows to it, the same way a status tab narrows by status.
  const [area, setArea] = useState<string | null>(null);
  const [selected, setSelected] = useState<Suggestion | null>(null);

  // Cursor rather than offset, for the reason the practitioner directory's
  // does: a log a walkthrough script feeds constantly would quietly show the
  // same row twice under offset paging if one landed between two pages.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  const queueKey = ['suggestions', status, area];
  const queue = useQuery({
    queryKey: [...queueKey, cursor],
    queryFn: () => {
      const params = new URLSearchParams({ status, limit: String(PAGE_SIZE) });
      if (area) params.set('area', area);
      if (cursor) params.set('cursor', cursor);
      return api.get<{ suggestions?: Suggestion[]; nextCursor?: string | null }>(
        `/api/v1/suggestions?${params.toString()}`,
      );
    },
    placeholderData: (previous) => previous,
  });
  const rows = queue.data?.suggestions ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  function chooseArea(next: string) {
    setArea((current) => (current === next ? null : next));
    startOver();
  }

  const summary = useQuery({
    queryKey: ['suggestions-summary'],
    queryFn: () => api.get<{ areas: AreaCount[] }>('/api/v1/suggestions/summary'),
  });

  const busiest = Math.max(1, ...(summary.data?.areas.map((row) => row.total) ?? [1]));

  if (selected) {
    return (
      <ScreenTransition screenKey={selected.id}>
        <SuggestionDetail suggestion={selected} onBack={() => setSelected(null)} />
      </ScreenTransition>
    );
  }

  return (
    <>
      <PageHeader
        title="Suggestions"
        description="What people said did not work. Decline reasons land here automatically and without the practitioner's name on them, because they were answering an invitation rather than filing a complaint."
      />

      {summary.data && summary.data.areas.length > 0 ? (
        <Card className="mb-6">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">Where the complaints are</CardTitle>
            {area ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto py-1 text-xs text-muted-foreground"
                onClick={() => chooseArea(area)}
              >
                <X />
                Clear
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-2.5">
            {summary.data.areas.map((row) => (
              <button
                key={row.area}
                type="button"
                onClick={() => chooseArea(row.area)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-accent',
                  area === row.area && 'bg-accent',
                )}
              >
                <span
                  className={cn(
                    'w-32 shrink-0 truncate text-left text-muted-foreground',
                    area === row.area && 'font-medium text-foreground',
                  )}
                >
                  {humanise(row.area)}
                </span>
                {/* A bar, because the useful reading is the comparison and a
                    column of numbers does not give you one at a glance. */}
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(row.total / busiest) * 100}%` }}
                  />
                </div>
                <span className="tabular w-16 shrink-0 text-right text-xs text-muted-foreground">
                  {row.total}
                  {row.open > 0 ? ` · ${row.open} open` : ''}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value);
          startOver();
        }}
        className="mb-5"
      >
        <TabsList>
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {humanise(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {queue.isPending ? (
        <QueueSkeleton rows={2} />
      ) : queue.isError ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MessageSquareText />}
          title={`Nothing ${status.toLowerCase()}${area ? ` in ${humanise(area).toLowerCase()}` : ''}`}
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
                    <MessageSquareText className="size-5" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    {/* Two lines of it, not one: a suggestion is prose and a
                        single truncated line is often just its preamble. */}
                    <p className="line-clamp-2 text-sm leading-relaxed">{row.body}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {row.raisedByName ?? (row.source === 'DECLINE_REASON' ? 'No name' : 'Unattributed')}
                      {' · '}
                      {formatAgo(row.createdAt)}
                      {row.response ? ' · answered' : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge variant="secondary">{humanise(row.area)}</Badge>
                    {row.source === 'DECLINE_REASON' ? (
                      <Badge variant="warning">Declined invitation</Badge>
                    ) : null}
                    <StatusBadge status={row.status} />
                  </div>
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
