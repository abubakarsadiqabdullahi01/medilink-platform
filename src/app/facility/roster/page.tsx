'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Phone, Users } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { agenda } from '@/lib/ui/agenda';
import { useCursorPager } from '@/lib/ui/cursor-pager';
import { useFacilityId } from '@/lib/ui/facility';
import { useNow } from '@/lib/ui/now';
import { useQueueAction } from '@/lib/ui/queue';
import { useSession } from '@/lib/ui/session';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { FilterBar } from '@/components/app/filter-bar';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { Pager } from '@/components/app/pager';
import { ErrorState, FilteredEmpty, TableSkeleton } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { formatAgo, formatShiftWindow } from '@/components/app/format';
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
 * This is scanned, not read one entry at a time, so on a wide screen it is a table; on a phone,
 * where the person using it is usually standing on the ward, each booking is a card that keeps
 * the same things — who, which shift, where attendance stands, what to do — with the phone number
 * as a link that dials and the buttons at full width. The table and the cards are both in the
 * page and CSS shows one, so nothing waits on a script to pick a layout.
 *
 * Attendance only has anything to say for a confirmed shift, so its column only exists on that
 * tab rather than sitting empty on the other three.
 *
 * Ordered by start time so the next shift is the first thing read — a roster ordered by when a row
 * was created is a roster nobody uses at 6am.
 */
export default function RosterPage() {
  const facilityId = useFacilityId();
  const session = useSession();
  const now = useNow();
  const canCancel = session.permissions.includes('assignment.cancel');
  const [cancelling, setCancelling] = useState<Assignment | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<string>('CONFIRMED');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const pager = useCursorPager();

  const queue = useQuery({
    queryKey: ['roster', facilityId, status, applied, from, to, pager.cursor],
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
        pager.cursor ? `cursor=${pager.cursor}` : '',
      ].filter(Boolean);
      return api.get<{ assignments?: Assignment[]; nextCursor?: string | null }>(
        `/api/v1/assignments?${parts.join('&')}`,
      );
    },
    enabled: Boolean(facilityId),
    // Rows stay on screen while a filter or page is fetched, but never from the other tab: a
    // "Cancelled" row under a "Confirmed" heading is a lie, however brief.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === status ? previous : undefined,
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
  const activeCount = (applied ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);
  const showsAttendance = status === 'CONFIRMED';
  // The confirmed tab reads as an agenda: by the day each shift starts, in Lagos time (M08-01). The
  // list is paged on the server, so this groups what is on the page; the date filters above narrow
  // it across pages.
  const groups: { key: string; heading: string | null; items: Assignment[] }[] = showsAttendance
    ? agenda(rows, now, 'all').groups
    : [{ key: 'all', heading: null, items: rows }];
  // Practitioner, shift, status or attendance, and — on the confirmed tab, for those who may — cancel.
  const columns = 3 + (showsAttendance && canCancel ? 1 : 0);

  function clearFilters() {
    setSearch('');
    setApplied('');
    setFrom('');
    setTo('');
    pager.startOver();
  }

  const windowOf = (row: Assignment) => formatShiftWindow(row.startsAt, row.endsAt);
  const canRelease = (row: Assignment) =>
    showsAttendance && canCancel && new Date(row.endsAt) > now;

  const who = (row: Assignment): ReactNode => (
    <>
      <span className="block font-medium">{row.practitionerName}</span>
      {row.practitionerPhone ? (
        <a
          href={`tel:${row.practitionerPhone.replace(/[^\d+]/g, '')}`}
          aria-label={`Call ${row.practitionerName} on ${row.practitionerPhone}`}
          className="tabular -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 font-mono text-sm font-normal text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          <Phone className="size-4" aria-hidden="true" />
          {row.practitionerPhone}
        </a>
      ) : (
        <span className="block text-sm font-normal text-muted-foreground">
          Phone shown from 2 days before the shift
        </span>
      )}
    </>
  );

  const when = (row: Assignment): ReactNode => (
    <>
      <span className="block">{windowOf(row)}</span>
      <span className="block text-sm text-muted-foreground">
        {new Date(row.startsAt) <= now ? 'started' : 'starts'} {formatAgo(row.startsAt)}
      </span>
    </>
  );

  const attendance = (row: Assignment): ReactNode =>
    facilityId ? (
      <AttendancePanel
        assignmentId={row.id}
        facilityId={facilityId}
        attendance={row.attendance}
        startsAt={row.startsAt}
        endsAt={row.endsAt}
        now={now}
        who={row.practitionerName}
      />
    ) : null;

  const release = (row: Assignment): ReactNode =>
    canRelease(row) ? (
      <Button
        variant="ghost"
        aria-label={`Cancel booking: ${row.practitionerName}, ${windowOf(row)}`}
        className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text max-md:w-full"
        onClick={() => {
          setCancelling(row);
          setReason('');
        }}
      >
        Cancel booking
      </Button>
    ) : null;

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
          pager.startOver();
        }}
        className="mb-4"
      >
        <TabsList aria-label="Booking status">
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {humanise(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <FilterBar
        searchLabel="Search by practitioner"
        searchPlaceholder="Search by name"
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
        <Field label="Starts after">
          <Input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              pager.startOver();
            }}
          />
        </Field>
        <Field label="Starts before">
          <Input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              pager.startOver();
            }}
          />
        </Field>
      </FilterBar>

      {queue.isPending ? (
        <TableSkeleton label="Loading the roster" columns={4} />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        activeCount > 0 ? (
          <FilteredEmpty noun="bookings" activeCount={activeCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            icon={<Users />}
            title={`Nothing ${humanise(status).toLowerCase()}`}
            description={
              status === 'CONFIRMED'
                ? 'Confirm somebody onto a published shift and they appear here.'
                : undefined
            }
          />
        )
      ) : (
        <>
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <caption className="sr-only">{humanise(status)} bookings</caption>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead scope="col" className="px-4 text-sm">
                    Practitioner
                  </TableHead>
                  <TableHead scope="col" className="px-4 text-sm">
                    Shift
                  </TableHead>
                  {showsAttendance ? (
                    <TableHead scope="col" className="px-4 text-sm">
                      Attendance
                    </TableHead>
                  ) : (
                    <TableHead scope="col" className="px-4 text-sm">
                      Status
                    </TableHead>
                  )}
                  {showsAttendance && canCancel ? (
                    <TableHead scope="col" className="px-4 text-right text-sm">
                      Next step
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    {group.heading ? (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableHead
                          scope="colgroup"
                          colSpan={columns}
                          className="h-auto px-4 py-2 text-sm font-semibold text-foreground"
                        >
                          {group.heading}
                        </TableHead>
                      </TableRow>
                    ) : null}
                    {group.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="px-4 py-3 align-top">{who(row)}</TableCell>
                        <TableCell className="px-4 py-3 align-top">{when(row)}</TableCell>
                        <TableCell className="min-w-[16rem] px-4 py-3 align-top">
                          {showsAttendance ? attendance(row) : <StatusBadge status={row.status} />}
                        </TableCell>
                        {showsAttendance && canCancel ? (
                          <TableCell className="px-4 py-3 text-right align-top">
                            {release(row)}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="space-y-5 md:hidden">
            {groups.map((group) => (
              <section key={group.key} aria-label={group.heading ?? `${humanise(status)} bookings`}>
                {group.heading ? (
                  <h2 className="mb-2 text-base font-semibold">{group.heading}</h2>
                ) : null}
                <ul className="space-y-3">
                  {group.items.map((row) => (
                    <li key={row.id}>
                      <Card className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 [overflow-wrap:anywhere]">{who(row)}</div>
                          {showsAttendance ? null : (
                            <div className="shrink-0">
                              <StatusBadge status={row.status} />
                            </div>
                          )}
                        </div>
                        <div>{when(row)}</div>
                        {showsAttendance ? <div>{attendance(row)}</div> : null}
                        {release(row)}
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <Pager
        pageIndex={pager.pageIndex}
        hasNext={Boolean(nextCursor)}
        busy={queue.isFetching}
        onPrevious={pager.goPrevious}
        onNext={() => pager.goNext(nextCursor)}
      />

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(next) => !next && setCancelling(null)}
        title="Cancel this booking"
        object={cancelling ? `${cancelling.practitionerName} · ${windowOf(cancelling)}` : ''}
        consequence={
          <>
            {cancelling
              ? `${cancelling.practitionerName} is released from this shift and sent a message saying it is cancelled. `
              : ''}
            The shift opens again for somebody else. Your reason is kept on the record; it is not
            sent to them.
          </>
        }
        reversible={false}
        destructive
        confirmLabel="Cancel the booking"
        cancelLabel="Keep the booking"
        loading={cancel.isPending}
        confirmDisabled={reason.trim().length < 3}
        onConfirm={() =>
          cancelling &&
          cancel.mutate({ id: cancelling.id }, { onSuccess: () => setCancelling(null) })
        }
      >
        <Field
          label="Reason"
          hint="Why this booking is being cancelled. At least 3 characters."
          required
        >
          <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
