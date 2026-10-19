'use client';

import { useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { useNow } from '@/lib/ui/now';
import { useQueue } from '@/lib/ui/queue';
import { agenda, type AgendaRange } from '@/lib/ui/agenda';
import { shiftMinutes } from '@/lib/ui/shift-figures';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { StaleNote } from '@/components/app/stale-note';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { formatAgo, formatMinutes, formatNaira, formatWhen } from '@/components/app/format';
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

const NOTHING: Record<string, { title: string; description?: string }> = {
  CONFIRMED: {
    title: 'Nothing confirmed',
    description: 'A shift appears here once a facility confirms you onto it.',
  },
  COMPLETED: {
    title: 'No completed shifts',
    description: 'A shift appears here once its hours have been approved.',
  },
  NO_SHOW: { title: 'No missed shifts' },
  CANCELLED: { title: 'No cancelled shifts' },
};

function ShiftCard({ row, now }: { row: Assignment; now: Date }) {
  const started = new Date(row.startsAt) <= now;
  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{formatWhen(row.startsAt)}</p>
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {row.facilityName}
            </p>
            <p className="text-sm text-muted-foreground">
              {started ? 'started' : 'starts'} {formatAgo(row.startsAt)}
            </p>
          </div>
          <StatusBadge status={row.status} />
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="min-w-0">
            <dt className="text-sm text-muted-foreground">Ends</dt>
            <dd className="[overflow-wrap:anywhere]">
              {formatWhen(row.endsAt)}
              <span className="text-muted-foreground">
                {' '}
                · {formatMinutes(shiftMinutes(row.startsAt, row.endsAt))}
              </span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-muted-foreground">Rate</dt>
            <dd className="tabular">
              {formatNaira(row.hourlyRateKobo)}/hour
              <span className="block text-sm text-muted-foreground">{humanise(row.shiftType)}</span>
            </dd>
          </div>
        </dl>

        {row.status === 'CONFIRMED' ? (
          <div className="border-t pt-3">
            <CheckInPanel
              assignmentId={row.id}
              startsAt={row.startsAt}
              endsAt={row.endsAt}
              attendance={row.attendance}
              now={now}
            />
          </div>
        ) : null}

        {(row.status === 'CONFIRMED' && new Date(row.endsAt) < now) || row.status === 'NO_SHOW' ? (
          <ExcusalPanel
            assignmentId={row.id}
            canAsk={row.status === 'CONFIRMED'}
            attendance={row.attendance}
          />
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
  now,
}: {
  rows: Assignment[];
  range: AgendaRange;
  onRange: (range: AgendaRange) => void;
  now: Date;
}) {
  const { groups, later } = agenda(rows, now, range);

  return (
    <div className="space-y-5">
      <Tabs value={range} onValueChange={(value) => onRange(value as AgendaRange)}>
        <TabsList aria-label="Which days to show">
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="week">Next 7 days</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {groups.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing {range === 'today' ? 'today' : 'in the next 7 days'}.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-labelledby={`day-${group.key}`}>
            <h2 id={`day-${group.key}`} className="mb-3 text-base font-semibold">
              {group.heading}
            </h2>
            <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {group.items.map((row) => (
                <ShiftCard key={row.id} row={row} now={now} />
              ))}
            </div>
          </section>
        ))
      )}

      {later > 0 ? (
        <p className="text-muted-foreground">
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
  // One clock for the page: every card's "can check in from" and "late" are worked out from it,
  // not from a timer each.
  const now = useNow();

  const queue = useQueue<Assignment>(
    ['my-shifts', status],
    // Each shift's attendance arrives with it: one request for the page.
    `/api/v1/assignments?scopeType=SELF&status=${status}&include=attendance`,
    (body) => (body as { assignments?: Assignment[] }).assignments ?? [],
  );

  const rows = [...(queue.data ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  const nothing = NOTHING[status] ?? { title: 'Nothing here' };

  return (
    <>
      <PageHeader
        title="My shifts"
        description="Confirmed shifts, soonest first. Check in when you arrive using the code the ward gives you."
      />

      <Tabs value={status} onValueChange={setStatus} className="mb-5">
        <TabsList aria-label="Shift status">
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {humanise(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <StaleNote
        show={queue.isError && Boolean(queue.data)}
        onRetry={() => void queue.refetch()}
        retrying={queue.isFetching}
        what="your shifts"
      />

      {queue.isPending ? (
        <ListSkeleton rows={2} label="Loading your shifts" />
      ) : queue.isError && !queue.data ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck />}
          title={nothing.title}
          description={nothing.description}
        />
      ) : status === 'CONFIRMED' ? (
        <Agenda rows={rows} range={range} onRange={setRange} now={now} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((row) => (
            <ShiftCard key={row.id} row={row} now={now} />
          ))}
        </div>
      )}
    </>
  );
}
