'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ArrowRight, CalendarPlus, Receipt, Users, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacility, useFacilityId } from '@/lib/ui/facility';
import { useSession } from '@/lib/ui/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/app/page-shell';

/** Kobo on the axis would be six digits of noise; naira is what people say. */
const naira = (kobo: number) => `₦${Math.round(kobo / 100).toLocaleString('en-NG')}`;

interface Assignment {
  id: string;
}

interface ServiceRequestRow {
  id: string;
  status: string;
  startsAt: string;
  headcount: number;
  confirmedCount?: number;
}

interface InvoiceRow {
  grossKobo: number;
  status: string;
  periodStart: string;
}

/** Both charts read the same two validated colours the finance overview
 * uses — see docs/interfaces.md: fixed slots of a categorical palette
 * checked for contrast and colour-vision separation in both themes, not a
 * hue picked per chart. */
const FULFILMENT_CONFIG = {
  needed: { label: 'People needed', color: 'hsl(var(--chart-2))' },
  filled: { label: 'People confirmed', color: 'hsl(var(--chart-1))' },
} satisfies ChartConfig;

const SPEND_CONFIG = {
  invoiced: { label: 'Invoiced', color: 'hsl(var(--chart-1))' },
  paid: { label: 'Paid', color: 'hsl(var(--chart-2))' },
} satisfies ChartConfig;

function weekLabel(iso: string): string {
  const date = new Date(iso);
  // Monday of that week, so two shifts three days apart land in one bar
  // instead of splitting across a week boundary nobody drew on a calendar.
  const day = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day);
  return monday.toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' });
}

function weekSortKey(iso: string): string {
  const date = new Date(iso);
  const day = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day);
  return monday.toISOString().slice(0, 10);
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    month: 'short',
    year: '2-digit',
  });
}

function monthSortKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Every page of a cursor-paginated list — a trend needs the whole history,
 * not just the newest page. Capped so a very old facility degrades to an
 * undercount rather than a long chain of requests. */
async function fetchAllServiceRequests(facilityId: string): Promise<ServiceRequestRow[]> {
  const rows: ServiceRequestRow[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < 10; index += 1) {
    const parts: string[] = [
      'scopeType=FACILITY',
      `scopeId=${facilityId}`,
      'limit=200',
      cursor ? `cursor=${cursor}` : '',
    ].filter(Boolean);
    const body: { requests?: ServiceRequestRow[]; nextCursor?: string | null } = await api.get(
      `/api/v1/service-requests?${parts.join('&')}`,
    );
    rows.push(...(body.requests ?? []));
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return rows;
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

  const canSeeFulfilment = can('service_request.read');
  const canSeeSpend = can('invoice.read');

  const requestHistory = useQuery({
    queryKey: ['facility-request-history', facilityId],
    queryFn: () => fetchAllServiceRequests(facilityId!),
    enabled: ready && canSeeFulfilment,
  });

  const invoiceHistory = useQuery({
    queryKey: ['facility-invoice-history', facilityId],
    queryFn: () => api.get<{ invoices?: InvoiceRow[] }>(`/api/v1/invoices?facilityId=${facilityId}`),
    enabled: ready && canSeeSpend,
  });

  // One bar per week, in headcount rather than shift count: a shift needing
  // three people going unfilled is a bigger gap than one needing one, and a
  // count of requests would show them as the same bar.
  const fulfilment = useMemo(() => {
    const buckets = new Map<string, { week: string; needed: number; filled: number }>();
    for (const row of requestHistory.data ?? []) {
      if (row.status === 'DRAFT') continue;
      const key = weekSortKey(row.startsAt);
      const bucket = buckets.get(key) ?? { week: weekLabel(row.startsAt), needed: 0, filled: 0 };
      bucket.needed += row.headcount;
      bucket.filled += Math.min(row.confirmedCount ?? 0, row.headcount);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  }, [requestHistory.data]);

  /** Invoiced against paid, by the month the work was done. */
  const spend = useMemo(() => {
    const buckets = new Map<string, { month: string; invoiced: number; paid: number }>();
    for (const row of invoiceHistory.data?.invoices ?? []) {
      const key = monthSortKey(row.periodStart);
      const bucket = buckets.get(key) ?? { month: monthLabel(row.periodStart), invoiced: 0, paid: 0 };
      bucket.invoiced += row.grossKobo;
      if (row.status === 'PAID') bucket.paid += row.grossKobo;
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  }, [invoiceHistory.data]);

  return (
    <>
      <PageHeader
        title={facility.data?.name ?? 'Your facility'}
        description="What this facility has open, and what is waiting on somebody here."
      />

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

      {!nothingGranted && (canSeeFulfilment || canSeeSpend) ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {canSeeFulfilment ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Staffing your shifts</CardTitle>
                <CardDescription>
                  People needed against people confirmed, by the week the shift falls in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {requestHistory.isPending ? (
                  <Skeleton className="h-[240px] w-full" />
                ) : fulfilment.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    Not enough shift history yet to chart a trend.
                  </p>
                ) : (
                  <ChartContainer config={FULFILMENT_CONFIG} className="h-[240px] w-full">
                    <BarChart data={fulfilment} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis tickLine={false} axisLine={false} tickMargin={8} width={28} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="needed" fill="var(--color-needed)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="filled" fill="var(--color-filled)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
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
                {invoiceHistory.isPending ? (
                  <Skeleton className="h-[240px] w-full" />
                ) : spend.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    Nothing invoiced yet.
                  </p>
                ) : (
                  <ChartContainer config={SPEND_CONFIG} className="h-[240px] w-full">
                    <BarChart data={spend} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        width={64}
                        tickFormatter={naira}
                      />
                      <ChartTooltip
                        content={<ChartTooltipContent formatter={(value) => naira(Number(value))} />}
                      />
                      <Bar dataKey="invoiced" fill="var(--color-invoiced)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="paid" fill="var(--color-paid)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
