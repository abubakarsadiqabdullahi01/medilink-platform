'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { agenda } from '@/lib/ui/agenda';
import { useQueueAction } from '@/lib/ui/queue';
import { useSession } from '@/lib/ui/session';
import { Button } from '@/components/ui/button';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader, ErrorState } from '@/components/app/page-shell';
import { formatAgo, formatWhen } from '@/components/app/format';
import { AttendancePanel, type Attendance } from './attendance-panel';

interface Assignment {
  id: string;
  serviceRequestId: string;
  userId: string;
  facilityId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  practitionerName: string;
  practitionerPhone: string;
  attendance?: Attendance | null;
}

const STATUSES = ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;
const PAGE_SIZE = 20;

/**
 * Who is due on the floor, and what happened when they got there.
 *
 * A table rather than a card per practitioner, for the same reason the
 * shifts list became one — this is scanned, not read one entry at a time.
 * Attendance only has anything to say for a confirmed shift, so its column
 * only exists on that tab rather than sitting empty on the other three.
 *
 * Ordered by start time so the next shift is the first thing read — a roster
 * ordered by when a row was created is a roster nobody uses at 6am.
 */
export default function RosterPage() {
  const facilityId = useFacilityId();
  const session = useSession();
  const canCancel = session.permissions.includes('assignment.cancel');
  const [cancelling, setCancelling] = useState<Assignment | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<string>('CONFIRMED');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex] ?? null;

  function startOver() {
    setCursors([null]);
    setPageIndex(0);
  }

  const queue = useQuery({
    queryKey: ['roster', facilityId, status, applied, from, to, cursor],
    queryFn: () => {
      const parts = [
        'scopeType=FACILITY',
        `scopeId=${facilityId}`,
        `status=${status}`,
        // Each row's attendance arrives with it, so the panels need no request of their own.
        // Their numbers too, because this is where a ward manager reaches somebody (inside the
        // window only, and each showing is recorded).
        'include=attendance,contact',
        `limit=${PAGE_SIZE}`,
        applied ? `search=${encodeURIComponent(applied)}` : '',
        from ? `from=${from}` : '',
        to ? `to=${to}` : '',
        cursor ? `cursor=${cursor}` : '',
      ].filter(Boolean);
      return api.get<{ assignments?: Assignment[]; nextCursor?: string | null }>(
        `/api/v1/assignments?${parts.join('&')}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  // Releasing one practitioner from a shift. The server tells them; this is
  // the only place a facility can do it, and without it the only way to
  // un-book somebody was to cancel the whole shift.
  const cancel = useQueueAction<{ id: string }>({
    queueKey: ['roster', facilityId],
    run: ({ id }) =>
      api.post(`/api/v1/assignments/${id}/cancel`, { facilityId, reason: reason.trim() }),
    success: 'Booking cancelled',
  });

  const rows = [...(queue.data?.assignments ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  const nextCursor = queue.data?.nextCursor ?? null;
  const filtered = Boolean(applied) || Boolean(from) || Boolean(to);
  const showsAttendance = status === 'CONFIRMED';
  // The confirmed tab reads as an agenda: by the day each shift starts, in Lagos time (M08-01). The
  // list is paged on the server, so this groups what is on the page; the date filters above narrow
  // it across pages.
  const groups: { key: string; heading: string | null; items: Assignment[] }[] = showsAttendance
    ? agenda(rows, new Date(), 'all').groups
    : [{ key: 'all', heading: null, items: rows }];
  const columns = 4 + (showsAttendance ? 1 : 0) + (showsAttendance && canCancel ? 1 : 0);

  function clearFilters() {
    setSearch('');
    setApplied('');
    setFrom('');
    setTo('');
    startOver();
  }

  return (
    <>
      <PageHeader
        title="Roster"
        description="Confirmed shifts, and the attendance behind them. The facility issues a code and the practitioner presents it — that direction is what makes it evidence rather than proof somebody owns a phone."
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
              <Label htmlFor="roster-search">Search by practitioner</Label>
              <Input
                id="roster-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="roster-from">Starts after</Label>
              <Input
                id="roster-from"
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
              <Label htmlFor="roster-to">Starts before</Label>
              <Input
                id="roster-to"
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
        <ErrorState message="The roster could not be loaded." onRetry={() => void queue.refetch()} retrying={queue.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={filtered ? 'Nothing matches that' : `Nothing ${humanise(status).toLowerCase()}`}
          description={
            filtered
              ? 'Try part of a name, or a different date range.'
              : status === 'CONFIRMED'
                ? 'Confirm somebody onto a published shift and they appear here.'
                : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Practitioner</TableHead>
                <TableHead className="w-[170px]">Starts</TableHead>
                <TableHead className="w-[150px]">Ends</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                {showsAttendance ? <TableHead>Attendance</TableHead> : null}
                {showsAttendance && canCancel ? <TableHead className="w-[90px]" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  {group.heading ? (
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={columns} className="py-1.5 text-xs font-semibold">
                        {group.heading}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {group.items.map((row) => {
                    const started = new Date(row.startsAt) <= new Date();

                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <p className="font-medium">{row.practitionerName}</p>
                          {row.practitionerPhone ? (
                            <p className="font-mono text-xs text-muted-foreground">
                              {row.practitionerPhone}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Phone shown from 2 days before the shift
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          <p>{formatWhen(row.startsAt)}</p>
                          <p className="text-muted-foreground">
                            {started ? 'started' : 'starts'} {formatAgo(row.startsAt)}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatWhen(row.endsAt)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        {showsAttendance ? (
                          <TableCell className="min-w-[260px]">
                            {facilityId ? (
                              <AttendancePanel assignmentId={row.id} facilityId={facilityId} attendance={row.attendance} />
                            ) : null}
                          </TableCell>
                        ) : null}
                        {showsAttendance && canCancel ? (
                          <TableCell>
                            {new Date(row.endsAt) > new Date() ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                                onClick={() => {
                                  setCancelling(row);
                                  setReason('');
                                }}
                              >
                                Cancel
                              </Button>
                            ) : null}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
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
            <DialogTitle>Cancel this booking</DialogTitle>
            <DialogDescription>
              {cancelling ? `${cancelling.practitionerName} is released from this shift and sent a message saying it is cancelled. ` : ''}
              The shift opens again for somebody else. Your reason is kept on the record; it is not
              sent to them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-booking-reason">Reason</Label>
            <Textarea
              id="cancel-booking-reason"
              rows={2}
              placeholder="Why this booking is being cancelled."
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
              Cancel the booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
