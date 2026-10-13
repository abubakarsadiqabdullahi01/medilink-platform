'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Search,
  Send,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { useQueueAction } from '@/lib/ui/queue';
import { nameOf, useReference } from '@/lib/ui/reference';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { formatNaira, formatWhen } from '@/components/app/format';
import { NewShiftDialog } from './new-shift-dialog';

interface ServiceRequest {
  id: string;
  facilityId: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  shiftType: string;
  startsAt: string;
  endsAt: string;
  headcount: number;
  confirmedCount?: number;
  hourlyRateKobo: number;
  urgency: string;
  status: string;
  cancellationTerms: string;
  notes: string | null;
}

const STATUSES = ['PUBLISHED', 'FILLED', 'DRAFT', 'CANCELLED', 'EXPIRED'] as const;
const PAGE_SIZE = 20;

/**
 * Module 6 — service requests, from the facility's side.
 *
 * A dense table rather than a stack of cards: this is the screen a scheduler
 * scans every morning, and a card per row means scrolling past nine tenths of
 * what is printed on it to compare two shifts. The row still links out to its
 * own detail page for the parts a table has no room for — notes, the full
 * cancellation terms, who has confirmed.
 *
 * Publishing an existing draft used to only be reachable by creating a new
 * shift from scratch — "Publish a shift" always did create-then-publish as
 * one step, and a draft left behind by a failed publish (the facility was not
 * verified yet, the rate floor moved, the start time had already passed by
 * the time the button was clicked) had no retry: cancel was the only action
 * on it. The publish endpoint was already separable from creation
 * (`POST .../:id/publish` takes an existing draft) — the row action below
 * just exposes it, so a draft stuck for a since-fixed reason does not have to
 * be rebuilt from nothing.
 */
export default function ShiftsPage() {
  const facilityId = useFacilityId();
  const reference = useReference();
  const session = useSession();

  /**
   * Shifts is reached on `service_request.read`, which several facility roles
   * hold without holding anything that changes a shift — an administrator, and
   * an accounts officer who needs it to open a timesheet. They were being shown
   * Publish, Cancel and New shift, and every one of them answered 403. The
   * dashboard beside this page already hides what a role cannot use; this is
   * the same rule, applied where the buttons are.
   */
  const canPublish = session.permissions.includes('service_request.publish');
  const canStaff = session.permissions.includes('assignment.confirm');
  const [status, setStatus] = useState<string>('PUBLISHED');
  const [categoryId, setCategoryId] = useState('all');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cancelling, setCancelling] = useState<ServiceRequest | null>(null);
  const [reason, setReason] = useState('');

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const queueKey = ['shifts', facilityId, status, categoryId, applied, from, to];
  const queue = useQuery({
    queryKey: [...queueKey, cursor],
    queryFn: () => {
      const parts = [
        'scopeType=FACILITY',
        `scopeId=${facilityId}`,
        `status=${status}`,
        `limit=${PAGE_SIZE}`,
        categoryId !== 'all' ? `professionalCategoryId=${categoryId}` : '',
        applied ? `search=${encodeURIComponent(applied)}` : '',
        from ? `from=${from}` : '',
        to ? `to=${to}` : '',
        cursor ? `cursor=${cursor}` : '',
      ].filter(Boolean);
      return api.get<{ requests?: ServiceRequest[]; nextCursor?: string | null }>(
        `/api/v1/service-requests?${parts.join('&')}`,
      );
    },
    enabled: Boolean(facilityId),
    placeholderData: (previous) => previous,
  });

  const rows = queue.data?.requests ?? [];
  const nextCursor = queue.data?.nextCursor ?? null;
  const filtered = categoryId !== 'all' || Boolean(applied) || Boolean(from) || Boolean(to);

  function clearFilters() {
    setCategoryId('all');
    setSearch('');
    setApplied('');
    setFrom('');
    setTo('');
    startOver();
  }

  const cancel = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) =>
      api.post(`/api/v1/service-requests/${id}/cancel`, { facilityId, reason: reason.trim() }),
    success: 'Shift cancelled',
  });

  // The same call "Publish a shift" makes as its second step — exposed here
  // as its own action so a draft stuck behind a since-fixed blocker (facility
  // verification, most often) can be retried without recreating it.
  const publish = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) => api.post(`/api/v1/service-requests/${id}/publish`, { facilityId }),
    success: 'Shift published',
  });

  const hoursOf = (row: ServiceRequest) =>
    (new Date(row.endsAt).getTime() - new Date(row.startsAt).getTime()) / 3_600_000;

  return (
    <>
      <PageHeader
        title="Shifts"
        description="A published shift can be offered to practitioners. Its terms cannot be changed after publishing — cancel it and publish another instead, so nobody accepts one thing and works another."
        action={facilityId && canPublish ? <NewShiftDialog facilityId={facilityId} /> : null}
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
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <Label htmlFor="shift-search">Search notes</Label>
              <Input
                id="shift-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ward, contact, anything written on the shift"
              />
            </div>

            <div className="min-w-[200px] space-y-1.5">
              <Label>Profession</Label>
              <Select
                value={categoryId}
                onValueChange={(value) => {
                  setCategoryId(value);
                  startOver();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every profession</SelectItem>
                  {(reference.data?.professionalCategories ?? []).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="shift-from">Starts after</Label>
              <Input
                id="shift-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  startOver();
                }}
                className="w-40"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="shift-to">Starts before</Label>
              <Input
                id="shift-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  startOver();
                }}
                className="w-40"
              />
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
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>These shifts could not be loaded.</AlertDescription>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus />}
          title={filtered ? 'Nothing matches that' : `No ${status.toLowerCase()} shifts`}
          description={
            filtered
              ? 'Try a different profession, date range, or clear the filters.'
              : status === 'PUBLISHED'
                ? 'Publish one and it becomes available to match against.'
                : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profession</TableHead>
                <TableHead className="w-[130px]">Type</TableHead>
                <TableHead className="w-[160px]">Starts</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="w-[80px] text-right">Filled</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const filled = row.confirmedCount ?? 0;
                const hours = hoursOf(row);
                const isPublishing = publish.isPending && publish.variables?.id === row.id;

                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/facility/shifts/${row.id}`} className="hover:underline">
                        <p className="font-medium">
                          {nameOf(reference.data?.professionalCategories, row.professionalCategoryId)}
                        </p>
                        {row.specialtyId ? (
                          <p className="text-xs text-muted-foreground">
                            {nameOf(reference.data?.specialties, row.specialtyId)}
                          </p>
                        ) : null}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="secondary">{humanise(row.shiftType)}</Badge>
                        {row.urgency !== 'ROUTINE' ? (
                          <Badge variant={row.urgency === 'EMERGENCY' ? 'destructive' : 'warning'}>
                            {humanise(row.urgency)}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <p>{formatWhen(row.startsAt)}</p>
                      <p className="text-muted-foreground">{hours} hours</p>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNaira(row.hourlyRateKobo)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {filled}/{row.headcount}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        {row.status === 'DRAFT' && canPublish ? (
                          <Button
                            size="sm"
                            loading={isPublishing}
                            onClick={() => publish.mutate({ id: row.id })}
                          >
                            <Send />
                            Publish
                          </Button>
                        ) : null}
                        {(row.status === 'PUBLISHED' || row.status === 'FILLED') && canStaff ? (
                          <Link
                            href={`/facility/shifts/${row.id}`}
                            className={buttonVariants({ variant: 'outline', size: 'sm' })}
                          >
                            <Users />
                            Find staff
                          </Link>
                        ) : (
                          <Link
                            href={`/facility/shifts/${row.id}`}
                            className={buttonVariants({ variant: 'outline', size: 'sm' })}
                          >
                            View
                          </Link>
                        )}
                        {(row.status === 'PUBLISHED' || row.status === 'DRAFT' || row.status === 'FILLED') &&
                        canPublish ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              setCancelling(row);
                              setReason('');
                            }}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
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

      <Dialog open={cancelling !== null} onOpenChange={(next: boolean) => !next && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this shift</DialogTitle>
            <DialogDescription>
              Any invitation still waiting for an answer is withdrawn, and anybody already
              confirmed is released from the shift and sent a message saying so. Your reason is
              kept on the record; it is not sent to them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              rows={2}
              placeholder="Why the shift is no longer needed."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3}
              loading={cancel.isPending}
              onClick={() =>
                cancelling &&
                cancel.mutate({ id: cancelling.id }, { onSuccess: () => setCancelling(null) })
              }
            >
              Cancel the shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
