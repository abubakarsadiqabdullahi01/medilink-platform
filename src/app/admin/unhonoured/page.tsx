'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileClock } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/app/data-table';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
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
  const pager = useCursorPager();

  const queue = useQuery({
    queryKey: ['unhonoured-queue', status, applied, pager.cursor],
    queryFn: () => {
      const parts = [
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        applied ? `search=${encodeURIComponent(applied)}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
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
  const activeCount = applied ? 1 : 0;

  function clearFilters() {
    setSearch('');
    setApplied('');
    pager.startOver();
  }

  const columns: Column<Unhonoured>[] = [
    {
      id: 'practitioner',
      header: 'Practitioner',
      role: 'identity',
      cell: (row) => (
        <span className="block">
          <span className="block font-medium">{row.practitionerName}</span>
          <span className="block text-sm font-normal text-muted-foreground">
            {row.facilityName}
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
    { id: 'ended', header: 'Shift ended', cell: (row) => formatAgo(row.shiftEndedAt) },
    { id: 'flagged', header: 'Flagged', cell: (row) => formatAgo(row.detectedAt) },
    {
      id: 'fault',
      header: 'Decided',
      cell: (row) => (row.fault ? `${humanise(row.fault)} at fault` : '—'),
    },
  ];

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
          pager.startOver();
        }}
        className="mb-4"
      >
        <TabsList aria-label="Flag status">
          {STATUSES.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar
        searchLabel="Search by practitioner or facility"
        searchPlaceholder="Adaeze, or Owerri General"
        searchValue={search}
        onSearchChange={setSearch}
        onSubmit={() => {
          setApplied(search.trim());
          pager.startOver();
        }}
        activeCount={activeCount}
        onClear={clearFilters}
        busy={queue.isFetching && !queue.isPending}
        summary={!queue.isPending && rows.length > 0 ? `${rows.length} on this page` : undefined}
      />

      {queue.isPending ? (
        <TableSkeleton label="Loading flagged shifts" columns={5} />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        activeCount > 0 ? (
          <FilteredEmpty noun="flagged shifts" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            icon={<FileClock />}
            title={
              status === 'AWAITING_DECISION' ? 'Nothing awaiting a decision' : 'Nothing decided yet'
            }
            description={
              status === 'AWAITING_DECISION'
                ? 'Every flagged shift has had somebody answer for it.'
                : undefined
            }
          />
        )
      ) : (
        <DataTable
          caption={status === 'AWAITING_DECISION' ? 'Shifts awaiting a decision' : 'Decided shifts'}
          rows={rows}
          columns={columns}
          getKey={(row) => row.id}
          actionHeader="Flag"
          rowTone={(row) => (row.status === 'AWAITING_DECISION' ? 'warning' : undefined)}
          action={(row) => (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Open the flag: ${row.practitionerName} at ${row.facilityName}`}
              onClick={() => setSelected(row)}
            >
              {row.status === 'AWAITING_DECISION' ? 'Decide' : 'View'}
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
