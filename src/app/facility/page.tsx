'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarPlus, ReceiptText, Users, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacility, useFacilityId } from '@/lib/ui/facility';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-shell';
import { FacilityAgreements } from './facility-agreements';

/** The shape of /api/v1/dashboard/facility; a section is absent when the caller may not see it. */
interface Summary {
  published?: number;
  roster?: number;
  awaitingApproval?: number;
  fulfilment?: { week: string; needed: number; filled: number }[];
  spend?: { month: string; invoicedKobo: number; paidKobo: number }[];
}

/** The charting library loads after the tiles and navigation have drawn. */
const FulfilmentChart = dynamic(() => import('@/components/app/money-charts').then((m) => m.FulfilmentChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[240px] w-full" />,
});
const SpendChart = dynamic(() => import('@/components/app/money-charts').then((m) => m.SpendChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[240px] w-full" />,
});

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-05" (a Monday) as "5 Oct". Parsed by hand so no time zone can move it a day. */
function weekLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-').map(Number);
  return `${day} ${SHORT_MONTHS[(month ?? 1) - 1]}`;
}

/** "2026-10" as "Oct 26". */
function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return `${SHORT_MONTHS[(month ?? 1) - 1]} ${String(year).slice(-2)}`;
}

/**
 * One tile, so the three read as one row rather than as three decisions.
 *
 * A failed fetch says so. Rendering `?? 0` in that case is the worst of the
 * three states: "nothing is waiting on you" and "we could not find out" look
 * identical, and only one of them is safe to act on.
 */
function Tile({
  href,
  label,
  icon: Icon,
  hint,
  count,
  isPending,
  isError,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  hint: string;
  count: number;
  isPending: boolean;
  isError: boolean;
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-all hover:border-primary/50 hover:shadow-md">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Icon className="size-4" />
            </span>
            <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>

          <p className="mt-4 text-sm font-medium">{label}</p>

          {isPending ? (
            <Skeleton className="mt-2 h-9 w-12" />
          ) : isError ? (
            <p className="mt-2 text-sm text-destructive">Could not load</p>
          ) : (
            <p
              className={
                count > 0
                  ? 'tabular mt-1 text-3xl font-semibold'
                  : 'tabular mt-1 text-3xl font-semibold text-muted-foreground'
              }
            >
              {count}
            </p>
          )}

          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function FacilityDashboard() {
  const session = useSession();
  const facilityId = useFacilityId();
  const facility = useFacility(facilityId);

  const can = (permission: string) => session.permissions.includes(permission);
  const ready = Boolean(facilityId);

  // One request for every number and both charts, scoped to the facility the
  // console is acting for. The key starts with 'tile', so the invalidation
  // every action already does refreshes it.
  const summary = useQuery({
    queryKey: ['tile', 'facility-summary', facilityId],
    queryFn: () => api.get<Summary>(`/api/v1/dashboard/facility?facilityId=${facilityId}`),
    enabled: ready,
    retry: false,
  });
  const data = summary.data;

  const unverified = facility.data && facility.data.status !== 'VERIFIED';
  const nothingGranted =
    !can('service_request.read') && !can('attendance.record') && !can('timesheet.approve');

  const canSeeFulfilment = can('service_request.read');
  const canSeeSpend = can('invoice.read');

  const fulfilment = useMemo(
    () => (data?.fulfilment ?? []).map((row) => ({ ...row, week: weekLabel(row.week) })),
    [data?.fulfilment],
  );

  /** Invoiced against paid, by the month the work was done. */
  const spend = useMemo(
    () =>
      (data?.spend ?? []).map((row) => ({
        month: monthLabel(row.month),
        invoiced: row.invoicedKobo,
        paid: row.paidKobo,
      })),
    [data?.spend],
  );

  return (
    <>
      <PageHeader
        title={facility.data?.name ?? 'Your facility'}
        description="What this facility has open, and what is waiting on somebody here."
      />

      {unverified ? (
        <Alert variant={facility.data?.status === 'PENDING' ? 'warning' : 'destructive'} className="mb-6">
          <AlertDescription className="space-y-1">
            {facility.data?.status === 'PENDING' ? (
              <p>
                <strong>Waiting for verification.</strong> Medilink checks the CAC registration
                and licence before this facility can publish shifts. You can set up rates and
                staff in the meantime.
              </p>
            ) : facility.data?.status === 'REJECTED' ? (
              <>
                <p>
                  <strong>Medilink could not verify this facility</strong>, so it cannot publish
                  shifts.
                </p>
                {facility.data.reviewNotes ? <p>What compliance said: {facility.data.reviewNotes}</p> : null}
                <p>
                  Correct what was wrong on the{' '}
                  <Link href="/facility/profile" className="font-medium underline underline-offset-4">
                    facility profile
                  </Link>{' '}
                  and send it back for review.
                </p>
              </>
            ) : (
              <p>
                <strong>This facility is suspended</strong> and cannot publish shifts. Contact
                Medilink for the reason and what is needed to lift it.
              </p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {facilityId ? <FacilityAgreements facilityId={facilityId} /> : null}

      {nothingGranted ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            This account holds no staffing permissions at this facility, so there is nothing to show
            here. That is the grants deciding what you see, not a page failing to load.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {can('service_request.read') ? (
            <Tile
              href="/facility/shifts"
              label="Shifts published"
              icon={CalendarPlus}
              hint="Open and waiting to be filled."
              count={data?.published ?? 0}
              isPending={summary.isPending}
              isError={summary.isError}
            />
          ) : null}

          {can('attendance.record') ? (
            <Tile
              href="/facility/roster"
              label="Confirmed on the roster"
              icon={Users}
              hint="Practitioners due on the floor."
              count={data?.roster ?? 0}
              isPending={summary.isPending}
              isError={summary.isError}
            />
          ) : null}

          {can('timesheet.approve') ? (
            <Tile
              href="/facility/timesheets"
              label="Timesheets to approve"
              icon={ReceiptText}
              hint="Submitted hours. Nothing is settled until these are decided."
              count={data?.awaitingApproval ?? 0}
              isPending={summary.isPending}
              // A missing timesheet on a confirmed shift is expected and
              // arrives as a per-row error; only a failed roster means the
              // number itself is unknown.
              isError={summary.isError}
            />
          ) : null}
        </div>
      )}

      {!nothingGranted && (canSeeFulfilment || canSeeSpend) ? (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          {canSeeFulfilment ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Staffing your shifts</CardTitle>
                <CardDescription>
                  People needed against people confirmed, by the week the shift falls in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {summary.isPending ? (
                  <Skeleton className="h-[240px] w-full" />
                ) : fulfilment.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    Not enough shift history yet to chart a trend.
                  </p>
                ) : (
                  <FulfilmentChart data={fulfilment} />
                )}
              </CardContent>
            </Card>
          ) : null}

          {canSeeSpend ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">What you&rsquo;re spending</CardTitle>
                <CardDescription>Invoiced against paid, by the month the work was done.</CardDescription>
              </CardHeader>
              <CardContent>
                {summary.isPending ? (
                  <Skeleton className="h-[240px] w-full" />
                ) : spend.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    Nothing invoiced yet.
                  </p>
                ) : (
                  <SpendChart data={spend} height={240} yAxisWidth={64} legend />
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
