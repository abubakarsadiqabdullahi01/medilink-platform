'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/app/data-table';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { ScreenTransition } from '@/components/app/motion';
import { formatAgo, formatWhen } from '@/components/app/format';
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
  const pager = useCursorPager();

  const queue = useQuery({
    queryKey: ['disputes', status, applied, pager.cursor],
    queryFn: () => {
      const parts = [
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        applied ? `search=${encodeURIComponent(applied)}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
      ].filter(Boolean);
      return api.get<{ disputes?: Dispute[]; nextCursor?: string | null }>(
        `/api/v1/disputes?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  const rows = queue.data?.disputes ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;
  const activeCount = applied ? 1 : 0;

  function clearFilters() {
    setSearch('');
    setApplied('');
    pager.startOver();
  }

  if (selected) {
    return (
      <ScreenTransition screenKey={selected.id}>
        <DisputeDetail dispute={selected} onBack={() => setSelected(null)} />
      </ScreenTransition>
    );
  }

  const columns: Column<Dispute>[] = [
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
    { id: 'shift', header: 'Shift', cell: (row) => formatWhen(row.shiftStartsAt) },
    {
      id: 'raised',
      header: 'Raised by',
      cell: (row) => (
        <span className="flex flex-wrap gap-1.5">
          <Badge variant={row.raisedParty === 'PRACTITIONER' ? 'info' : 'warning'}>
            {row.raisedParty === 'PRACTITIONER' ? 'Practitioner' : 'Facility'}
          </Badge>
          <Badge variant="secondary">{humanise(row.category)}</Badge>
        </span>
      ),
    },
    {
      // One line of the reason. The whole of it is a click away, and a queue of full paragraphs
      // is a queue nobody scans.
      id: 'reason',
      header: 'What they said',
      cell: (row) => <span className="line-clamp-2 font-normal">{row.reason}</span>,
    },
    {
      id: 'opened',
      header: 'Opened',
      cell: (row) =>
        row.status === 'OPEN' || row.status === 'UNDER_REVIEW' ? formatAgo(row.createdAt) : '—',
    },
  ];

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
          pager.startOver();
        }}
        className="mb-4"
      >
        <TabsList aria-label="Dispute status">
          {STATUSES.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar
        searchLabel="Search by practitioner or facility"
        searchPlaceholder="Ngozi, or Ibadan University Hospital"
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
        <TableSkeleton label="Loading disputes" columns={5} />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        activeCount > 0 ? (
          <FilteredEmpty noun="disputes" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState icon={<Gavel />} title={`No ${humanise(status).toLowerCase()} cases`} />
        )
      ) : (
        <DataTable
          caption={`${humanise(status)} disputes`}
          rows={rows}
          columns={columns}
          getKey={(row) => row.id}
          actionHeader="Case"
          rowTone={(row) => (row.status === 'OPEN' ? 'warning' : undefined)}
          action={(row) => (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Open the case: ${row.practitionerName} at ${row.facilityName}`}
              onClick={() => setSelected(row)}
            >
              {row.status === 'OPEN' || row.status === 'UNDER_REVIEW' ? 'Open case' : 'View'}
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
