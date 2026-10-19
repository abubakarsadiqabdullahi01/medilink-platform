'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { useFacilityId } from '@/lib/ui/facility';
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
import { formatAgo, formatWhen } from '@/components/app/format';
import { ReportIncidentDialog } from './report-incident-dialog';
import { IncidentDetailDialog, type FacilityIncident } from './incident-detail-dialog';

const STATUSES = [
  ['all', 'Every status'],
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

/**
 * Clinical incidents — the list, with reporting and the full record of one
 * both reached through their own dialogs rather than sharing this screen.
 *
 * Nothing here can be edited: the report said so when it was filed, and nor
 * can this page act on it — that is compliance's queue, not this one's. What
 * this adds is the half of the story a facility could not see before: once a
 * case is closed, its outcome and the notes behind it are now readable here,
 * not only from the admin console.
 *
 * The list used to read every report a facility had ever filed in one
 * unfiltered call — fine at ten, unusable past a hundred. It shares the
 * compliance queue's own filters now, narrowed to this facility, and
 * defaults to every status rather than the queue's "open only" — this is a
 * facility's own history, not a worklist to triage.
 */
export default function FacilityIncidentsPage() {
  const facilityId = useFacilityId();
  const [selected, setSelected] = useState<FacilityIncident | null>(null);

  const [status, setStatus] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');

  const pager = useCursorPager();

  const queue = useQuery({
    queryKey: ['facility-incidents', facilityId, status, severity, category, applied, pager.cursor],
    queryFn: () => {
      const parts = [
        `facilityId=${facilityId}`,
        `limit=${PAGE_SIZE}`,
        status !== 'all' ? `status=${status}` : '',
        severity !== 'all' ? `severity=${severity}` : '',
        category !== 'all' ? `category=${category}` : '',
        applied ? `search=${encodeURIComponent(applied)}` : '',
        pager.cursor ? `cursor=${pager.cursor}` : '',
      ].filter(Boolean);
      return api.get<{ incidents?: FacilityIncident[]; nextCursor?: string | null }>(
        `/api/v1/incidents?${parts.join('&')}`,
      );
    },
    enabled: Boolean(facilityId),
    placeholderData: (previous) => previous,
  });

  const rows = queue.data?.incidents ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;
  const activeCount =
    (status !== 'all' ? 1 : 0) +
    (severity !== 'all' ? 1 : 0) +
    (category !== 'all' ? 1 : 0) +
    (applied ? 1 : 0);

  function clearFilters() {
    setStatus('all');
    setSeverity('all');
    setCategory('all');
    setSearch('');
    setApplied('');
    pager.startOver();
  }

  const columns: Column<FacilityIncident>[] = [
    {
      id: 'summary',
      header: 'What was reported',
      role: 'identity',
      cell: (row) => <span className="line-clamp-3 font-normal">{row.summary}</span>,
    },
    {
      id: 'severity',
      header: 'Severity',
      cell: (row) => <SeverityBadge severity={row.severity} />,
    },
    { id: 'category', header: 'Category', cell: (row) => humanise(row.category) },
    { id: 'occurred', header: 'Happened', cell: (row) => formatWhen(row.occurredAt) },
    { id: 'reported', header: 'Reported', cell: (row) => formatAgo(row.reportedAt) },
    {
      id: 'status',
      header: 'Status',
      role: 'status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Clinical incidents"
        description="A report is not an accusation. Most incidents turn out to be a system failing rather than a person, and naming somebody is optional here for exactly that reason."
        action={facilityId ? <ReportIncidentDialog facilityId={facilityId} /> : null}
      />

      <FilterBar
        searchLabel="Search what was reported"
        searchPlaceholder="infusion pump, handover notes…"
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
        <Field label="Status" className="md:min-w-[10rem]">
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
        <Field label="Severity" className="md:min-w-[10rem]">
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
        <Field label="Category" className="md:min-w-[11rem]">
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
          <FilteredEmpty noun="reports" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            icon={<Stethoscope />}
            title="Nothing reported yet"
            description="A report you file appears here, with compliance's outcome once it is closed."
          />
        )
      ) : (
        <DataTable
          caption="Clinical incidents reported by this facility"
          rows={rows}
          columns={columns}
          getKey={(row) => row.id}
          actionHeader="Record"
          action={(row) => (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Read the report: ${row.summary.slice(0, 70)}${row.summary.length > 70 ? '…' : ''}`}
              onClick={() => setSelected(row)}
            >
              Read
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

      <IncidentDetailDialog incident={selected} onClose={() => setSelected(null)} />
    </>
  );
}
