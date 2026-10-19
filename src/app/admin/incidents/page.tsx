'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
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
import { DataTable, type Column } from '@/components/app/data-table';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { SeverityBadge, StatusBadge, humanise } from '@/components/app/status-badge';
import { ScreenTransition } from '@/components/app/motion';
import { formatAgo } from '@/components/app/format';
import { IncidentDetail, type Incident } from './incident-detail';

/**
 * The compliance queue for clinical incidents.
 *
 * **The order, said as it is.** The API reads the register newest report first, cuts it into
 * pages of twenty, and then puts the most serious first *within each page*. So on any one page a
 * death outranks a near miss, but a serious report from March can sit on page two behind a minor
 * one from this morning. This page used to say "most serious first" without that qualification;
 * it now says what is true, and tells the reader how to see every serious case at once (filter by
 * severity). The ordering itself is the API's and is not changed here.
 *
 * Closed cases are reachable. The queue only ever showed open ones, so "what did we decide about
 * that one in August" had no answer short of the database, which is a poor property for the
 * register of patient-safety decisions.
 */

const STATUSES = [
  ['OPEN', 'Open'],
  ['REPORTED', 'Reported'],
  ['UNDER_REVIEW', 'Under review'],
  ['CLOSED', 'Closed'],
] as const;

const SEVERITIES = ['DEATH', 'SEVERE', 'MODERATE', 'MINOR', 'NEAR_MISS'] as const;

const CATEGORIES = [
  'MEDICATION',
  'CLINICAL_PROCEDURE',
  'DOCUMENTATION',
  'INFECTION_CONTROL',
  'EQUIPMENT',
  'STAFFING',
  'CONDUCT',
  'OTHER',
] as const;

const PAGE_SIZE = 20;

export default function IncidentsPage() {
  const [status, setStatus] = useState<string>('OPEN');
  const [severity, setSeverity] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [selected, setSelected] = useState<Incident | null>(null);
  const pager = useCursorPager();

  const queue = useQuery({
    queryKey: ['incident-queue', status, severity, category, applied, pager.cursor],
    queryFn: () => {
      const parts = [
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        severity !== 'all' ? `severity=${severity}` : '',
        category !== 'all' ? `category=${category}` : '',
        applied ? `search=${encodeURIComponent(applied)}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
      ].filter(Boolean);
      return api.get<{ incidents?: Incident[]; nextCursor?: string | null }>(
        `/api/v1/incidents/queue?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  if (selected) {
    return (
      <ScreenTransition screenKey={selected.id}>
        <IncidentDetail incident={selected} onBack={() => setSelected(null)} />
      </ScreenTransition>
    );
  }

  const rows = queue.data?.incidents ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;
  // The status is the list being looked at, so only a status other than the default counts as
  // something to clear.
  const activeCount =
    (status !== 'OPEN' ? 1 : 0) +
    (severity !== 'all' ? 1 : 0) +
    (category !== 'all' ? 1 : 0) +
    (applied ? 1 : 0);

  function clearFilters() {
    setStatus('OPEN');
    setSearch('');
    setApplied('');
    setSeverity('all');
    setCategory('all');
    pager.startOver();
  }

  const describe = (row: Incident) => `${humanise(row.category)} at ${row.facilityName}`;

  const columns: Column<Incident>[] = [
    {
      // How serious it is, and on a phone where it stands, go above what it says: the first thing
      // read, and the whole width left for the words. In the table, status has its own column.
      id: 'summary',
      header: 'Severity and what was reported',
      role: 'identity',
      cell: (row) => (
        <span className="block space-y-1.5">
          <span className="flex flex-wrap gap-1.5">
            <SeverityBadge severity={row.severity} />
            <span className="md:hidden">
              <StatusBadge status={row.status} />
            </span>
          </span>
          <span className="line-clamp-4 font-normal leading-relaxed">{row.summary}</span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      hideOnCard: true,
      cell: (row) => <StatusBadge status={row.status} />,
    },
    { id: 'category', header: 'Category', cell: (row) => humanise(row.category) },
    { id: 'facility', header: 'Facility', cell: (row) => row.facilityName },
    {
      id: 'reported',
      header: 'Reported',
      cell: (row) => formatAgo(row.reportedAt),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clinical incidents"
        description="Newest reports first. Within each page of twenty the most serious come first, so an older serious report can sit on a later page; filter by severity to see every one. A report is not an accusation — most of these end as a system issue, which is the answer a blame-first process never reaches."
      />

      <FilterBar
        searchLabel="Search what was reported"
        searchPlaceholder="infusion pump, handover notes"
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
      >
        <Field label="Status" className="md:w-44">
          {(a11y) => (
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                pager.startOver();
              }}
            >
              <SelectTrigger {...a11y}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Severity" className="md:w-44">
          {(a11y) => (
            <Select
              value={severity}
              onValueChange={(value) => {
                setSeverity(value);
                pager.startOver();
              }}
            >
              <SelectTrigger {...a11y}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any severity</SelectItem>
                {SEVERITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {humanise(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Category" className="md:w-48">
          {(a11y) => (
            <Select
              value={category}
              onValueChange={(value) => {
                setCategory(value);
                pager.startOver();
              }}
            >
              <SelectTrigger {...a11y}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any category</SelectItem>
                {CATEGORIES.map((value) => (
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
        <TableSkeleton label="Loading incidents" columns={5} />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        activeCount > 0 ? (
          <FilteredEmpty noun="incidents" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            icon={<Stethoscope />}
            title="Nothing open"
            description="Every reported incident has been closed with an outcome and a reason."
          />
        )
      ) : (
        <DataTable
          caption="Clinical incidents"
          rows={rows}
          columns={columns}
          getKey={(row) => row.id}
          actionHeader="Case"
          // A serious case still waiting is marked on its edge as well as in its badge.
          rowTone={(row) =>
            row.status !== 'CLOSED' && (row.severity === 'DEATH' || row.severity === 'SEVERE')
              ? 'danger'
              : undefined
          }
          action={(row) => (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Open the case: ${describe(row)}, ${humanise(row.severity)}`}
              onClick={() => setSelected(row)}
            >
              {row.status === 'CLOSED' ? 'View' : 'Open case'}
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
