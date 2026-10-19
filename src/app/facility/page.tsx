'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarPlus,
  CircleAlert,
  Clock,
  ReceiptText,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacility, useFacilityId } from '@/lib/ui/facility';
import { facilityAttention, type FacilitySummaryJson } from '@/lib/ui/facility-today';
import { useNow } from '@/lib/ui/now';
import { useSession } from '@/lib/ui/session';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AttentionList,
  DashboardSection,
  MetricGrid,
  MetricTile,
} from '@/components/app/dashboard';
import { EmptyState, PageHeader } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { MyInvitations } from '@/components/app/my-invitations';
import { waitingFor } from '@/components/app/queue-age';
import { formatClock, formatNairaTight, formatShiftWindow } from '@/components/app/format';
import { humanise } from '@/components/app/status-badge';
import { FacilityAgreements } from './facility-agreements';
import { NewShiftLauncher } from './shifts/new-shift-launcher';

/**
 * A ward manager's morning: is today covered, what is still open, who is waiting on whom, has
 * everybody arrived, and what will cost us if it is left.
 *
 * It used to be three counts and two charts — how many, never *what to do*. The "roster" figure
 * was every confirmed shift of any date, labelled "due on the floor". Now:
 *
 *   1. the one primary action: publish a shift, or — if this facility cannot yet — finish what
 *      stops it
 *   2. what needs attention, most urgent first (the rules are in lib/ui/facility-today.ts)
 *   3. four figures: today's cover, open shifts, timesheets to approve, outstanding invoices
 *   4. today's shifts and the next ones short of people, each a link to staff it
 *
 * Everything is read from the one `/api/v1/dashboard/facility` request and the facility record
 * the console already fetches. A section the person may not see is absent — not zero. The two
 * charts are gone: they answered nothing anybody does today, and a seven-figure y-axis does not
 * fit on a phone. The data behind them is still served, for Finance.
 */
export default function FacilityDashboard() {
  const session = useSession();
  const facilityId = useFacilityId();
  const facility = useFacility(facilityId);
  const now = useNow();

  const can = (permission: string) => session.permissions.includes(permission);

  // One request for every number, scoped to the facility the console is acting for. The key
  // starts with 'tile', so the invalidation every action already does refreshes it.
  const summary = useQuery({
    queryKey: ['tile', 'facility-summary', facilityId],
    queryFn: () =>
      api.get<FacilitySummaryJson>(`/api/v1/dashboard/facility?facilityId=${facilityId}`),
    enabled: Boolean(facilityId),
    retry: false,
  });
  const data = summary.data;

  const nothingGranted =
    !can('service_request.read') &&
    !can('attendance.record') &&
    !can('timesheet.approve') &&
    !can('invoice.read');

  const attention = useMemo(
    () => facilityAttention({ summary: data, facility: facility.data, now }),
    [data, facility.data, now],
  );

  const mayPublish = facility.data ? facility.data.canPublish !== false : true;
  const loading = summary.isPending && !nothingGranted;

  const coverage = data?.coverage;
  const failed = summary.isError;

  return (
    <>
      <PageHeader
        title={facility.data?.name ?? 'Your facility'}
        description={new Intl.DateTimeFormat('en-NG', {
          timeZone: 'Africa/Lagos',
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }).format(now)}
        action={
          facilityId && can('service_request.publish') ? (
            mayPublish ? (
              <NewShiftLauncher facilityId={facilityId} size="lg" />
            ) : (
              <Link href="/facility/profile" className={buttonVariants({ size: 'lg' })}>
                Finish verification
                <ArrowRight />
              </Link>
            )
          ) : null
        }
      />

      <div className="space-y-8">
        {/* Invited to a facility, and not yet part of one, is where an account created for this lands. */}
        <MyInvitations className="" />

        {facilityId ? <FacilityAgreements facilityId={facilityId} /> : null}

        {nothingGranted ? (
          <Card>
            <CardContent className="pt-6 text-base text-muted-foreground">
              This account holds no staffing permissions at this facility, so there is nothing to
              show here. That is the grants deciding what you see, not a page failing to load.
            </CardContent>
          </Card>
        ) : (
          <>
            {failed ? (
              <ErrorState
                error={summary.error}
                onRetry={() => void summary.refetch()}
                retrying={summary.isFetching}
                compact
              />
            ) : null}

            <AttentionList
              items={attention}
              loading={loading || facility.isPending}
              error={failed && attention.length === 0}
              emptyTitle="Nothing needs your attention"
              emptyDetail="Today is covered, nobody is waiting on you, and nothing is about to lapse."
            />

            <MetricGrid compact>
              {coverage ? (
                <MetricTile
                  compact
                  label="Today's cover"
                  value={
                    coverage.todayShifts === 0
                      ? '—'
                      : `${coverage.todayFilled} of ${coverage.todayNeeded}`
                  }
                  hint={
                    coverage.todayShifts === 0
                      ? 'No shifts today'
                      : coverage.todayUnfilledShifts === 0
                        ? 'Fully staffed'
                        : `${coverage.todayUnfilledShifts} ${coverage.todayUnfilledShifts === 1 ? 'shift' : 'shifts'} short of people`
                  }
                  href="/facility/shifts"
                  tone={
                    coverage.todayUnfilledShifts > 0
                      ? 'warning'
                      : coverage.todayShifts > 0
                        ? 'success'
                        : 'neutral'
                  }
                  icon={Users}
                />
              ) : loading ? (
                <MetricTile compact label="Today's cover" value="" loading />
              ) : null}
              {coverage ? (
                <MetricTile
                  compact
                  label="Open shifts"
                  value={coverage.openShifts}
                  hint={
                    coverage.openShifts === 0
                      ? 'Every published shift is staffed'
                      : coverage.openNext24h > 0
                        ? `${coverage.openNext24h} start within 24 hours`
                        : 'None start within 24 hours'
                  }
                  href="/facility/shifts"
                  tone={coverage.openNext24h > 0 ? 'warning' : 'neutral'}
                  icon={CalendarPlus}
                />
              ) : loading ? (
                <MetricTile compact label="Open shifts" value="" loading />
              ) : null}
              {data?.awaitingApproval !== undefined ? (
                <MetricTile
                  compact
                  label="Timesheets to approve"
                  className="max-sm:col-span-full"
                  value={data.awaitingApproval}
                  hint={
                    data.awaitingApproval === 0
                      ? 'Nothing waiting'
                      : data.awaitingOldest
                        ? `Oldest ${waitingFor(data.awaitingOldest, now)} ago`
                        : undefined
                  }
                  href="/facility/timesheets"
                  tone={data.awaitingApproval > 0 ? 'warning' : 'neutral'}
                  icon={ReceiptText}
                />
              ) : loading && can('timesheet.approve') ? (
                <MetricTile
                  compact
                  label="Timesheets to approve"
                  className="max-sm:col-span-full"
                  value=""
                  loading
                />
              ) : null}
              {data?.invoices ? (
                <MetricTile
                  compact
                  label="Outstanding invoices"
                  className="max-sm:col-span-full"
                  value={formatNairaTight(data.invoices.outstandingKobo)}
                  hint={
                    data.invoices.outstandingCount === 0
                      ? 'Nothing outstanding'
                      : `${data.invoices.outstandingCount} issued${
                          data.invoices.paid30dKobo > 0
                            ? ` · ${formatNairaTight(data.invoices.paid30dKobo)} paid in 30 days`
                            : ''
                        }`
                  }
                  href="/facility/invoices"
                  icon={Wallet}
                />
              ) : loading && can('invoice.read') ? (
                <MetricTile
                  compact
                  label="Outstanding invoices"
                  className="max-sm:col-span-full"
                  value=""
                  loading
                />
              ) : null}
            </MetricGrid>

            {can('service_request.read') ? (
              <div className="grid items-start gap-8 xl:grid-cols-2">
                <DashboardSection
                  id="today-heading"
                  title="Today's shifts"
                  description="Lagos time."
                  href="/facility/roster"
                  hrefLabel="Open the roster"
                >
                  {loading ? (
                    <Skeleton className="h-28 w-full" />
                  ) : !coverage ? (
                    <ErrorState
                      error={summary.error}
                      onRetry={() => void summary.refetch()}
                      compact
                    />
                  ) : coverage.today.length === 0 ? (
                    <EmptyState
                      compact
                      icon={<Clock />}
                      title="No shifts today"
                      description="Shifts that start today, filled or not, appear here."
                    />
                  ) : (
                    <ShiftRows rows={coverage.today} now={now} />
                  )}
                </DashboardSection>

                <DashboardSection
                  id="open-heading"
                  title="Next shifts short of people"
                  description="The soonest first. Open one to find and offer."
                  href="/facility/shifts"
                  hrefLabel="All shifts"
                >
                  {loading ? (
                    <Skeleton className="h-28 w-full" />
                  ) : !coverage ? (
                    <ErrorState
                      error={summary.error}
                      onRetry={() => void summary.refetch()}
                      compact
                    />
                  ) : coverage.open.length === 0 ? (
                    <EmptyState
                      compact
                      icon={<Users />}
                      title="Every published shift is staffed"
                      description="When a published shift still has places open, it appears here."
                    />
                  ) : (
                    <ShiftRows rows={coverage.open} now={now} />
                  )}
                </DashboardSection>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

type Row = NonNullable<FacilitySummaryJson['coverage']>['today'][number];

function ShiftRows({ rows, now }: { rows: Row[]; now: Date }) {
  return (
    <Card>
      <ul className="divide-y">
        {rows.map((row) => {
          const short = row.filled < row.headcount;
          const ended = new Date(row.endsAt) <= now;
          return (
            <li key={row.id}>
              <Link
                href={`/facility/shifts/${row.id}`}
                className="flex min-h-16 items-start justify-between gap-3 p-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block font-medium leading-snug">
                    {row.profession} · {humanise(row.shiftType)}
                  </span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                    {formatShiftWindow(row.startsAt, row.endsAt)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {row.urgency === 'URGENT' ? (
                    <Badge variant="destructive">
                      <CircleAlert aria-hidden="true" /> Urgent
                    </Badge>
                  ) : null}
                  <Badge variant={short && !ended ? 'warning' : 'success'}>
                    <span className="tabular">
                      {row.filled} of {row.headcount}
                    </span>{' '}
                    {row.headcount === 1 ? 'place' : 'places'} filled
                  </Badge>
                  {short && new Date(row.startsAt) > now ? (
                    <span className="text-sm text-muted-foreground">
                      starts {formatClock(row.startsAt)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
