'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { endOfLagosDay, lagosDate, startOfLagosDay } from '@/lib/lagos-date';
import { useReference, nameOf } from '@/lib/ui/reference';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ICON } from '@/components/app/icons';
import { EmptyState, ErrorState } from '@/components/app/page-shell';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { formatWhen } from '@/components/app/format';
import { watClock } from '@/lib/wat';

/**
 * The two lists under a facility's numbers: what still needs people, and who is due today.
 *
 * The tiles say how many; these say which. A scheduler who sees "13 shifts published" has to open
 * the list and sort it to find the one that starts tonight, and the one that starts tonight is the
 * only one that matters this hour. Both ask the endpoints the shifts and roster pages already use,
 * for a handful of rows, and show at most five.
 */

const SHOWN = 5;

interface OpenShift {
  id: string;
  professionalCategoryId: string;
  startsAt: string;
  endsAt: string;
  headcount: number;
  confirmedCount?: number;
  urgency: string;
}

/** Shifts still out for offers, soonest first, with how far along filling them is. */
export function ShiftsToFill({ facilityId }: { facilityId: string }) {
  const reference = useReference();
  const queue = useQuery({
    queryKey: ['tile', 'shifts-to-fill', facilityId],
    queryFn: () =>
      api.get<{ requests?: OpenShift[] }>(
        `/api/v1/service-requests?scopeType=FACILITY&scopeId=${facilityId}&status=PUBLISHED&limit=50`,
      ),
    retry: false,
  });

  // Soonest first, and not the ones that are over: an unfilled shift from last week is a record, not a job.
  const rows = [...(queue.data?.requests ?? [])]
    .filter((row) => new Date(row.endsAt) > new Date())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-h3">Shifts still to fill</CardTitle>
        <CardDescription>Soonest first. Open one to find candidates or confirm an offer.</CardDescription>
      </CardHeader>
      <CardContent>
        {queue.isPending ? (
          <RowSkeleton />
        ) : queue.isError ? (
          <ErrorState
            message="These shifts could not be loaded."
            onRetry={() => void queue.refetch()}
            retrying={queue.isFetching}
          />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<ICON.shift />} title="Nothing waiting for people" description="Every published shift is filled or over." />
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.slice(0, SHOWN).map((row) => (
              <li key={row.id}>
                <Link
                  href={`/facility/shifts/${row.id}`}
                  className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors duration-fast hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">
                      {nameOf(reference.data?.professionalCategories, row.professionalCategoryId)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatWhen(row.startsAt)} ·{' '}
                      <span className="tabular">
                        {row.confirmedCount ?? 0} of {row.headcount} confirmed
                      </span>
                    </p>
                  </div>
                  {row.urgency !== 'ROUTINE' ? (
                    <Badge variant={row.urgency === 'EMERGENCY' ? 'destructive' : 'warning'}>
                      {humanise(row.urgency)}
                    </Badge>
                  ) : null}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {rows.length > SHOWN ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {rows.length - SHOWN} more.{' '}
            <Link href="/facility/shifts" className="font-medium text-primary underline-offset-4 hover:underline">
              See all shifts
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface TodayAssignment {
  id: string;
  practitionerName: string;
  startsAt: string;
  endsAt: string;
  attendance?: { status: string } | null;
}

/** Who is due on the floor today, and whether they have arrived. */
export function TodayOnTheFloor({ facilityId }: { facilityId: string }) {
  const today = lagosDate(new Date());
  // Instants, not dates. A bare date reaches the API as midnight, so `to=<today>` is the start of
  // today and the window is empty; and midnight UTC is 01:00 in Lagos, which would drop a shift
  // that starts at half past twelve.
  const from = startOfLagosDay(today).toISOString();
  const to = endOfLagosDay(today).toISOString();
  const queue = useQuery({
    queryKey: ['tile', 'today-on-the-floor', facilityId, today],
    queryFn: () =>
      api.get<{ assignments?: TodayAssignment[] }>(
        `/api/v1/assignments?scopeType=FACILITY&scopeId=${facilityId}&status=CONFIRMED&include=attendance&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=50`,
      ),
    retry: false,
    // Somebody arriving is the thing being watched for.
    refetchInterval: 60_000,
  });

  const rows = [...(queue.data?.assignments ?? [])].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-h3">Today on the floor</CardTitle>
        <CardDescription>Who is due today, and whether they have checked in.</CardDescription>
      </CardHeader>
      <CardContent>
        {queue.isPending ? (
          <RowSkeleton />
        ) : queue.isError ? (
          <ErrorState
            message="Today’s roster could not be loaded."
            onRetry={() => void queue.refetch()}
            retrying={queue.isFetching}
          />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<ICON.roster />} title="Nobody is rostered today" />
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.slice(0, SHOWN).map((row) => (
              <li key={row.id}>
                <Link
                  href="/facility/roster"
                  className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition-colors duration-fast hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{row.practitionerName}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {/* Today, so the date is not repeated: only when it starts and when it ends. */}
                      {watClock(new Date(row.startsAt))} – {watClock(new Date(row.endsAt))}
                    </p>
                  </div>
                  <StatusBadge status={row.attendance?.status ?? 'NOT_STARTED'} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {rows.length > SHOWN ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {rows.length - SHOWN} more.{' '}
            <Link href="/facility/roster" className="font-medium text-primary underline-offset-4 hover:underline">
              See the roster
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RowSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}
