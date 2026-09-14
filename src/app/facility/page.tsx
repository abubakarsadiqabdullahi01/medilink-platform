'use client';

import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarPlus, Receipt, Users, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacility, useFacilityId, useFacilityIds } from '@/lib/ui/facility';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-shell';

interface Assignment {
  id: string;
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
  const facilityIds = useFacilityIds();
  const facilityId = useFacilityId();
  const facility = useFacility(facilityId);

  const can = (permission: string) => session.permissions.includes(permission);
  const ready = Boolean(facilityId);

  const published = useQuery({
    queryKey: ['tile', 'published', facilityId],
    queryFn: async () => {
      const body = await api.get<{ requests?: unknown[] }>(
        `/api/v1/service-requests?scopeType=FACILITY&scopeId=${facilityId}&status=PUBLISHED`,
      );
      return (body.requests ?? []).length;
    },
    enabled: ready && can('service_request.read'),
  });

  // The roster answers two tiles: who is due on the floor, and — once each
  // row's timesheet has been read — how many are actually waiting on a
  // reviewer.
  const roster = useQuery({
    queryKey: ['tile', 'roster', facilityId],
    queryFn: async () => {
      const body = await api.get<{ assignments?: Assignment[] }>(
        `/api/v1/assignments?scopeType=FACILITY&scopeId=${facilityId}&status=CONFIRMED`,
      );
      return body.assignments ?? [];
    },
    enabled: ready && (can('attendance.record') || can('timesheet.approve')),
  });

  /**
   * Only a `SUBMITTED` timesheet is waiting on this facility.
   *
   * This tile used to count confirmed assignments, which made it an exact copy
   * of the roster tile beside it and told a ward manager that every shift on
   * the floor needed reviewing. There is no "timesheets waiting" endpoint —
   * the queue page reads them one per row for the same reason — so this asks
   * the same question the same way, and shares the cache key so the two
   * cannot disagree.
   */
  const sheets = useQueries({
    queries: can('timesheet.approve')
      ? (roster.data ?? []).map((row) => ({
          queryKey: ['timesheet', row.id],
          queryFn: () =>
            api.get<{ timesheet: { attendanceStatus: string } }>(
              `/api/v1/assignments/${row.id}/timesheet?scopeType=FACILITY&scopeId=${facilityId}`,
            ),
          // A confirmed shift with no timesheet yet is the normal case, not an
          // error worth retrying three times per row.
          retry: false,
        }))
      : [],
  });

  const awaitingReview = sheets.filter(
    (sheet) => sheet.data?.timesheet?.attendanceStatus === 'SUBMITTED',
  ).length;

  const unverified = facility.data && facility.data.status !== 'VERIFIED';
  const nothingGranted =
    !can('service_request.read') && !can('attendance.record') && !can('timesheet.approve');

  return (
    <>
      <PageHeader
        title={facility.data?.name ?? 'Your facility'}
        description="What this facility has open, and what is waiting on somebody here."
      />

      {/* Somebody who works at two hospitals is shown the first of them, and
          was shown it silently. Switching is not built; saying which one is
          in view is the least this owes them. */}
      {facilityIds.length > 1 ? (
        <Alert variant="info" className="mb-6">
          <AlertDescription>
            This account holds grants at {facilityIds.length} facilities. Everything in this console
            is for <strong>{facility.data?.name ?? 'the first of them'}</strong> only — switching
            between them is not built yet.
          </AlertDescription>
        </Alert>
      ) : null}

      {unverified ? (
        <Alert variant="warning" className="mb-6">
          <AlertDescription>
            This facility is <strong>{facility.data?.status.toLowerCase()}</strong>, so it cannot
            publish shifts yet. Compliance verifies it once the licence has been checked.
          </AlertDescription>
        </Alert>
      ) : null}

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
              count={published.data ?? 0}
              isPending={published.isPending}
              isError={published.isError}
            />
          ) : null}

          {can('attendance.record') ? (
            <Tile
              href="/facility/roster"
              label="Confirmed on the roster"
              icon={Users}
              hint="Practitioners due on the floor."
              count={roster.data?.length ?? 0}
              isPending={roster.isPending}
              isError={roster.isError}
            />
          ) : null}

          {can('timesheet.approve') ? (
            <Tile
              href="/facility/timesheets"
              label="Timesheets to approve"
              icon={Receipt}
              hint="Submitted hours. Nothing is settled until these are decided."
              count={awaitingReview}
              isPending={roster.isPending || sheets.some((sheet) => sheet.isPending)}
              // A missing timesheet on a confirmed shift is expected and
              // arrives as a per-row error; only a failed roster means the
              // number itself is unknown.
              isError={roster.isError}
            />
          ) : null}
        </div>
      )}
    </>
  );
}
