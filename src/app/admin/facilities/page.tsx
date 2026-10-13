'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronLeft, ChevronRight, Search, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
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
import { formatAgo } from '@/components/app/format';
import { FacilityDetail, type Facility } from './facility-detail';

/**
 * Facility verification — step 5.10.
 *
 * A facility cannot publish a shift until it is verified, so this queue
 * decides which hospitals can ask for anybody at all.
 *
 * It was status tabs over an unpaginated list, which worked while there were
 * six facilities and stopped working at sixty: no way to find one by name, no
 * way past the first fifty, and nothing to open — a card carried enough to
 * verify from and nothing to judge with. The API already took `stateId`,
 * `limit` and `cursor`; only search had to be added.
 */

const STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
const PAGE_SIZE = 20;

export default function FacilitiesPage() {
  const reference = useReference();

  const [status, setStatus] = useState<string>('PENDING');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [stateId, setStateId] = useState('all');
  const [selected, setSelected] = useState<Facility | null>(null);

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const directory = useQuery({
    queryKey: ['facility-directory', status, applied, stateId, cursor],
    queryFn: () => {
      const parts = [
        'scopeType=PLATFORM',
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        applied ? `search=${encodeURIComponent(applied)}` : '',
        stateId !== 'all' ? `stateId=${stateId}` : '',
        cursor ? `cursor=${cursor}` : '',
      ].filter(Boolean);
      return api.get<{ facilities?: Facility[]; nextCursor?: string | null }>(
        `/api/v1/facilities?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  if (selected) {
    return (
      <ScreenTransition screenKey={selected.id}>
        <FacilityDetail facility={selected} onBack={() => setSelected(null)} />
      </ScreenTransition>
    );
  }

  const rows = directory.data?.facilities ?? [];
  const nextCursor = directory.data?.nextCursor ?? null;

  return (
    <>
      <PageHeader
        title="Facilities"
        description="A facility cannot publish a shift until it is verified — and changing the licence of a verified one sends it straight back to this queue."
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
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {humanise(value)}
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
              <Label htmlFor="facility-search">Search by name or CAC number</Label>
              <Input
                id="facility-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Owerri General, or RC123456"
              />
            </div>

            <div className="min-w-[180px] space-y-1.5">
              <Label>State</Label>
              <Select
                value={stateId}
                onValueChange={(value) => {
                  setStateId(value);
                  startOver();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every state</SelectItem>
                  {(reference.data?.states ?? []).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" loading={directory.isFetching}>
              <Search />
              Search
            </Button>

            {applied || stateId !== 'all' ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setApplied('');
                  setStateId('all');
                  startOver();
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>

          {!directory.isPending && rows.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">{rows.length} on this page</p>
          ) : null}
        </CardContent>
      </Card>

      {directory.isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : directory.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>This queue could not be loaded.</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={
            applied || stateId !== 'all'
              ? 'Nothing matches that'
              : status === 'PENDING'
                ? 'Nothing waiting'
                : `No ${status.toLowerCase()} facilities`
          }
          description={
            applied || stateId !== 'all'
              ? 'Try part of the name, or the CAC number on their paperwork.'
              : status === 'PENDING'
                ? 'Every facility has been decided. New ones appear the moment a hospital registers.'
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
                    <Building2 className="size-5" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.name}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {row.cacNumber}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {row.addressLine} · onboarded {formatAgo(row.createdAt)}
                    </p>
                  </div>

                  {/* The licence is the thing being checked, so its absence
                      belongs on the row rather than one click further in. */}
                  <span
                    className={cn(
                      'hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:inline',
                      row.licenceObjectKey
                        ? 'bg-success/10 text-success'
                        : 'bg-warning/10 text-warning',
                    )}
                  >
                    {row.licenceObjectKey ? 'Licence attached' : 'No licence'}
                  </span>

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
            disabled={pageIndex === 0 || directory.isFetching}
            onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
          >
            <ChevronLeft />
            Previous
          </Button>

          <p className="tabular text-xs text-muted-foreground">
            Page {pageIndex + 1}
            {directory.isFetching ? ' · loading' : ''}
          </p>

          <Button
            variant="outline"
            size="sm"
            disabled={!nextCursor || directory.isFetching}
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
