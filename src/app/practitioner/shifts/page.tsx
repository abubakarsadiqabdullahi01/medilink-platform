'use client';

import { useState } from 'react';
import { CalendarCheck, } from 'lucide-react';
import { useQueue } from '@/lib/ui/queue';
import { agenda, type AgendaRange } from '@/lib/ui/agenda';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import {
  Detail,
  DetailGrid,
  EmptyState,
  PageHeader,
  QueueSkeleton, ErrorState } from '@/components/app/page-shell';
import { formatAgo, formatNaira, formatWhen } from '@/components/app/format';
import { CheckInPanel, type Attendance } from './check-in-panel';
import { ExcusalPanel } from './excusal-panel';

interface Assignment {
  id: string;
  serviceRequestId: string;
  facilityId: string;
  facilityName: string;
  shiftType: string;
  hourlyRateKobo: number;
  status: string;
  startsAt: string;
  endsAt: string;
  attendance?: Attendance | null;
}

const STATUSES = ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;

function ShiftCard({ row }: { row: Assignment }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
        <div className="min-w-0">
          <p className="font-medium">{formatWhen(row.startsAt)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date(row.startsAt) <= new Date() ? 'started' : 'starts'}{' '}
            {formatAgo(row.startsAt)}
          </p>
        </div>
        <StatusBadge status={row.status} />
      </CardHeader>

      <CardContent className="space-y-4">
        <DetailGrid>
          <Detail label="Ends">{formatWhen(row.endsAt)}</Detail>
          <Detail label="Facility">{row.facilityName}</Detail>
          <Detail label="Type">{humanise(row.shiftType)}</Detail>
          <Detail label="Rate">{formatNaira(row.hourlyRateKobo)}/hour</Detail>
        </DetailGrid>

        {row.status === 'CONFIRMED' ? (
          <>
            <Separator />
            <CheckInPanel assignmentId={row.id} startsAt={row.startsAt} attendance={row.attendance} />
          </>
        ) : null}

        {(row.status === 'CONFIRMED' && new Date(row.endsAt) < new Date()) ||
        row.status === 'NO_SHOW' ? (
          <ExcusalPanel assignmentId={row.id} canAsk={row.status === 'CONFIRMED'} attendance={row.attendance} />
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Confirmed shifts by the day they start, in Lagos time, with Today / Next 7 days / All (M08-01).
 * A shift that has ended and is still confirmed is shown first whatever the range: it is the one
 * that needs hours or an excuse, not one to scroll past.
 */
function Agenda({
  rows,
  range,
  onRange,
}: {
  rows: Assignment[];
  range: AgendaRange;
  onRange: (range: AgendaRange) => void;
}) {
  const { groups, later } = agenda(rows, new Date(), range);

  return (
    <div className="space-y-5">
      <Tabs value={range} onValueChange={(value) => onRange(value as AgendaRange)}>
        <TabsList>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="week">Next 7 days</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing {range === 'today' ? 'today' : 'in the next 7 days'}.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-labelledby={`day-${group.key}`}>
            <h2 id={`day-${group.key}`} className="mb-3 text-sm font-semibold">
              {group.heading}
            </h2>
            <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {group.items.map((row) => (
                <ShiftCard key={row.id} row={row} />
              ))}
            </div>
          </section>
        ))
      )}

      {later > 0 ? (
        <p className="text-sm text-muted-foreground">
          {later} more shift{later === 1 ? '' : 's'} later.{' '}
          <Button variant="link" className="h-auto p-0" onClick={() => onRange('all')}>
            Show all
          </Button>
        </p>
      ) : null}
    </div>
  );
}

export default function MyShiftsPage() {
  const [status, setStatus] = useState<string>('CONFIRMED');
  const [range, setRange] = useState<AgendaRange>('all');

  const queue = useQueue<Assignment>(
    ['my-shifts', status],
    // Each shift's attendance arrives with it: one request for the page.
    `/api/v1/assignments?scopeType=SELF&status=${status}&include=attendance`,
    (body) => (body as { assignments?: Assignment[] }).assignments ?? [],
  );

  const rows = [...(queue.data ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  return (
    <>
      <PageHeader
        title="My shifts"
        description="Confirmed shifts, soonest first. Check in when you arrive using the code the ward gives you."
      />

      <Tabs value={status} onValueChange={setStatus} className="mb-5">
        <TabsList>
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {humanise(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <ErrorState message="Your shifts could not be loaded." onRetry={() => void queue.refetch()} retrying={queue.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck />}
          title={`Nothing ${status.toLowerCase().replace('_', ' ')}`}
          description={
            status === 'CONFIRMED'
              ? 'A shift appears here once a facility confirms you onto it.'
              : undefined
          }
        />
      ) : (
        status === 'CONFIRMED' ? (
          <Agenda rows={rows} range={range} onRange={setRange} />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {rows.map((row) => (
              <ShiftCard key={row.id} row={row} />
            ))}
          </div>
        )
      )}
    </>
  );
}
