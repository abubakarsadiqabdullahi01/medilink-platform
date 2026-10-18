'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, Stethoscope, } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
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
import { SeverityBadge, StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader, ErrorState } from '@/components/app/page-shell';
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

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const queue = useQuery({
    queryKey: ['facility-incidents', facilityId, status, severity, category, applied, cursor],
    queryFn: () => {
      const parts = [
        `facilityId=${facilityId}`,
        `limit=${PAGE_SIZE}`,
        status !== 'all' ? `status=${status}` : '',
        severity !== 'all' ? `severity=${severity}` : '',
        category !== 'all' ? `category=${category}` : '',
        applied ? `search=${encodeURIComponent(applied)}` : '',
        cursor ? `cursor=${cursor}` : '',
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
  const filtered = status !== 'all' || severity !== 'all' || category !== 'all' || Boolean(applied);

  function clearFilters() {
    setStatus('all');
    setSeverity('all');
    setCategory('all');
    setSearch('');
    setApplied('');
    startOver();
  }

  return (
    <>
      <PageHeader
        title="Clinical incidents"
        description="A report is not an accusation. Most incidents turn out to be a system failing rather than a person, and naming somebody is optional here for exactly that reason."
        action={facilityId ? <ReportIncidentDialog facilityId={facilityId} /> : null}
      />

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
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label htmlFor="incident-search">Search what was reported</Label>
              <Input
                id="incident-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="infusion pump, handover notes…"
              />
            </div>

            <div className="min-w-[150px] space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  startOver();
                }}
              >
                <SelectTrigger>
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
            </div>

            <div className="min-w-[150px] space-y-1.5">
              <Label>Severity</Label>
              <Select
                value={severity}
                onValueChange={(value) => {
                  setSeverity(value);
                  startOver();
                }}
              >
                <SelectTrigger>
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
            </div>

            <div className="min-w-[170px] space-y-1.5">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(value) => {
                  setCategory(value);
                  startOver();
                }}
              >
                <SelectTrigger>
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
            </div>

            <Button type="submit" loading={queue.isFetching}>
              <Search />
              Search
            </Button>

            {filtered ? (
              <Button type="button" variant="ghost" onClick={clearFilters}>
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
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : queue.isError ? (
        <ErrorState message="These could not be loaded." onRetry={() => void queue.refetch()} retrying={queue.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Stethoscope />}
          title={filtered ? 'Nothing matches that' : 'Nothing reported yet'}
          description={filtered ? 'Try a different status, severity or category.' : undefined}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <button key={row.id} type="button" onClick={() => setSelected(row)} className="w-full text-left">
              <Card className="transition-all hover:border-primary/50 hover:shadow-md">
                <CardContent className="space-y-2 pt-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={row.severity} />
                    <StatusBadge status={row.status} />
                    <span className="text-xs text-muted-foreground">
                      {humanise(row.category)} · occurred {formatWhen(row.occurredAt)} · reported{' '}
                      {formatAgo(row.reportedAt)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{row.summary}</p>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
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

      <IncidentDetailDialog incident={selected} onClose={() => setSelected(null)} />
    </>
  );
}
