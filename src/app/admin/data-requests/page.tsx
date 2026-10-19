'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Clock, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/app/data-table';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
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
  const pager = useCursorPager();

  const queue = useQuery({
    queryKey: ['request-queue', status, kind, applied, pager.cursor],
    queryFn: () => {
      const parts = [
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        kind !== 'all' ? `kind=${kind}` : '',
        applied ? `search=${encodeURIComponent(applied)}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
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
  const activeCount = (kind !== 'all' ? 1 : 0) + (applied ? 1 : 0);

  function clearFilters() {
    setSearch('');
    setApplied('');
    setKind('all');
    pager.startOver();
  }

  const isOpen = (row: SubjectRequest) => row.status === 'RECEIVED' || row.status === 'IN_PROGRESS';

  const columns: Column<SubjectRequest>[] = [
    {
      id: 'subject',
      header: 'Subject',
      role: 'identity',
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{row.subjectName}</span>
          <span className="block text-sm font-normal text-muted-foreground">
            {humanise(row.kind)}
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      role: 'status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      // The clock is the point of this queue, so it reads as a countdown rather than a date
      // somebody has to subtract — with a mark and the words, not only a colour.
      id: 'clock',
      header: 'Deadline',
      cell: (row) => {
        if (!isOpen(row)) return '—';
        const left = daysLeft(row.dueBy);
        const text = row.overdue
          ? `${Math.abs(left)} days over`
          : left === 0
            ? 'Due today'
            : `${left} days left`;
        const Icon = row.overdue ? CircleAlert : Clock;
        return (
          <span
            className={
              row.overdue
                ? 'inline-flex items-center gap-1.5 font-medium text-destructive-text'
                : left <= 7
                  ? 'inline-flex items-center gap-1.5 font-medium text-warning'
                  : 'inline-flex items-center gap-1.5 text-muted-foreground'
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {text}
          </span>
        );
      },
    },
    { id: 'due', header: 'Due', cell: (row) => formatWhen(row.dueBy) },
    { id: 'received', header: 'Received', cell: (row) => formatAgo(row.receivedAt) },
  ];

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
          pager.startOver();
        }}
        className="mb-4"
      >
        <TabsList aria-label="Request status">
          {STATUSES.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar
        searchLabel="Search by subject"
        searchPlaceholder="Their name, or the number they registered with"
        searchValue={search}
        onSearchChange={setSearch}
        onSubmit={() => {
          setApplied(search.trim());
          pager.startOver();
        }}
        activeCount={activeCount}
        onClear={clearFilters}
        busy={queue.isFetching && !queue.isPending}
        summary={
          !queue.isPending && rows.length > 0 ? (
            <>
              {rows.length} on this page
              {overdue > 0 ? (
                <span className="font-medium text-destructive-text">
                  {' '}
                  · {overdue} past the deadline
                </span>
              ) : null}
            </>
          ) : undefined
        }
      >
        <Field label="Right" className="md:w-48">
          {(a11y) => (
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value);
                pager.startOver();
              }}
            >
              <SelectTrigger {...a11y}>
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
          )}
        </Field>
      </FilterBar>

      {queue.isPending ? (
        <TableSkeleton label="Loading requests" columns={5} />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        activeCount > 0 ? (
          <FilteredEmpty noun="requests" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            icon={<ShieldCheck />}
            title="Nothing waiting"
            description="Every request has been answered within its month."
          />
        )
      ) : (
        <DataTable
          caption={`${humanise(status)} data requests`}
          rows={rows}
          columns={columns}
          getKey={(row) => row.id}
          actionHeader="Request"
          rowTone={(row) =>
            row.overdue && isOpen(row)
              ? 'danger'
              : isOpen(row) && daysLeft(row.dueBy) <= 7
                ? 'warning'
                : undefined
          }
          action={(row) => (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Open the request: ${humanise(row.kind)}, ${row.subjectName}`}
              onClick={() => setSelected(row)}
            >
              {isOpen(row) ? 'Answer' : 'View'}
            </Button>
          )}
        />
      )}

      <Pager
        pageIndex={pager.pageIndex}
        hasNext={Boolean(nextCursor)}
        busy={queue.isFetching}
        onPrevious={pager.goPrevious}
        onNext={() => pager.goNext(nextCursor)}
      />
    </>
  );
}
