'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ArrowRight,
  Building2,
  FileCheck2,
  FileClock,
  Gavel,
  History,
  MessageSquareText,
  Stethoscope,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import { useSession } from '@/lib/ui/session';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { humanise } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-shell';
import { formatAgo } from '@/components/app/format';

/**
 * What is waiting, how long it has been waiting, and what happened recently.
 *
 * Counts come from fetching each list and taking its length rather than from
 * count endpoints. None of these queues is ever long enough for that to cost
 * anything, and a count endpoint per queue is a second thing that can disagree
 * with the queue it counts. Having the rows in hand is also what lets a tile
 * say *how old* the oldest one is, which is the part a number alone never
 * tells you: eleven credentials waiting an hour is a normal morning, and one
 * waiting nine days is somebody who has given up on us.
 */

interface Waiting {
  createdAt?: string;
  reportedAt?: string;
  submittedAt?: string;
  openedAt?: string;
}

interface Tile {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: string;
  path: string;
  pick: (body: unknown) => Waiting[];
  hint: string;
}

const TILES: Tile[] = [
  {
    href: '/admin/credentials',
    label: 'Credentials to review',
    icon: FileCheck2,
    permission: 'credential.review',
    path: '/api/v1/credentials?scopeType=PLATFORM&status=PENDING',
    pick: (body) => (body as { submissions?: Waiting[] }).submissions ?? [],
    hint: 'A practitioner is ineligible until every mandatory credential is verified.',
  },
  {
    href: '/admin/facilities',
    label: 'Facilities to verify',
    icon: Building2,
    permission: 'facility.verify',
    path: '/api/v1/facilities?scopeType=PLATFORM&status=PENDING',
    pick: (body) => (body as { facilities?: Waiting[] }).facilities ?? [],
    hint: 'An unverified facility cannot publish a shift.',
  },
  {
    href: '/admin/incidents',
    label: 'Clinical incidents open',
    icon: Stethoscope,
    permission: 'incident.manage',
    // Explicit limit: the queue endpoint pages at 20 by default, and a tile
    // that counted one page would understate the backlog.
    //
    // Explicit status too. The endpoint applies no status filter when none is
    // asked for — deliberately, so a facility can read its whole history — so
    // a tile headed "open" that left it unstated counted closed cases as
    // waiting, and clicking through to /admin/incidents, which does ask for
    // OPEN, showed fewer than the tile promised.
    path: '/api/v1/incidents/queue?status=OPEN&limit=100',
    pick: (body) => (body as { incidents?: Waiting[] }).incidents ?? [],
    hint: 'Most serious first. A death outranks a near miss from March.',
  },
  {
    href: '/admin/disputes',
    label: 'Disputes to adjudicate',
    icon: Gavel,
    permission: 'dispute.manage',
    path: '/api/v1/disputes',
    pick: (body) => (body as { disputes?: Waiting[] }).disputes ?? [],
    hint: 'A decided shift the two sides disagree about.',
  },
  {
    href: '/admin/unhonoured',
    label: 'Shifts awaiting fault',
    icon: FileClock,
    permission: 'sanction.apply',
    // Explicit limit, same reason as the incident tile: the queue pages at
    // 20 and a tile counting one page would understate the backlog.
    path: '/api/v1/unhonoured?limit=100',
    pick: (body) => (body as { unhonoured?: Waiting[] }).unhonoured ?? [],
    hint: 'A sweep flags these. Only a person can close one.',
  },
  {
    href: '/admin/suggestions',
    label: 'Suggestions untriaged',
    icon: MessageSquareText,
    permission: 'suggestion.triage',
    path: '/api/v1/suggestions?status=NEW',
    pick: (body) => (body as { suggestions?: Waiting[] }).suggestions ?? [],
    hint: 'What the pilot is telling you, decline reasons included.',
  },
];

interface Incident {
  id: string;
  severity: string;
  category: string;
  summary: string;
  reportedAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
}

/** Whichever date a row carries — the queues do not agree on the name. */
function waitingSince(row: Waiting): number | null {
  const value = row.createdAt ?? row.reportedAt ?? row.submittedAt ?? row.openedAt;
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function oldestOf(rows: Waiting[]): number | null {
  const times = rows.map(waitingSince).filter((time): time is number => time !== null);
  return times.length > 0 ? Math.min(...times) : null;
}

/** Past a working week, something has gone wrong with the queue, not the row. */
const STALE_AFTER_DAYS = 5;

const SEVERITY_ORDER = ['DEATH', 'SEVERE', 'MODERATE', 'MINOR', 'NEAR_MISS'];

/**
 * Growth, across the three things a pilot actually wants to see moving: new
 * facilities, new practitioners, and how much the platform gets used once
 * they are on it. Registration without usage is a pipeline; usage without
 * registration is a ceiling — three lines rather than one headline is what
 * tells those two problems apart.
 *
 * Usage is muted rather than a third bright hue: `docs/interfaces.md`
 * documents the two chart colours as slots of a validated categorical
 * palette (contrast and colour-vision separation checked for both themes),
 * and there is no third validated slot to draw from. It also carries its own
 * axis — registrations run in the tens and usage in the thousands, and one
 * shared axis would flatten the smaller two into an invisible line along the
 * bottom.
 */
const GROWTH_CHART_CONFIG = {
  facilities: { label: 'Facilities registered', color: 'hsl(var(--chart-1))' },
  practitioners: { label: 'Practitioners registered', color: 'hsl(var(--chart-2))' },
  usage: { label: 'Platform activity', color: 'hsl(var(--muted-foreground))' },
} satisfies ChartConfig;

interface CreatedRow {
  createdAt: string;
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    month: 'short',
    year: '2-digit',
  });
}

/** Sortable regardless of locale, unlike the label above. */
function monthSortKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Every page of a cursor-paginated list, not just the newest one — a growth
 * line needs the whole history. Capped at twenty pages so a pathologically
 * large table degrades to an undercount rather than a hung request.
 */
async function fetchAllPages<T extends CreatedRow>(
  basePath: string,
  extract: (body: unknown) => { rows: T[]; nextCursor: string | null },
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < 20; index += 1) {
    const body = await api.get(cursor ? `${basePath}&cursor=${cursor}` : basePath);
    const result = extract(body);
    rows.push(...result.rows);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return rows;
}

export default function DashboardPage() {
  const session = useSession();
  const mine = TILES.filter((tile) => session.permissions.includes(tile.permission));

  const results = useQueries({
    queries: mine.map((tile) => ({
      queryKey: ['tile', tile.path],
      queryFn: async () => tile.pick(await api.get(tile.path)),
    })),
  });

  const canSeeIncidents = session.permissions.includes('incident.manage');
  const canSeeAudit = session.permissions.includes('audit.read');

  const incidents = useQuery({
    queryKey: ['dashboard-incidents'],
    queryFn: async () =>
      (await api.get<{ incidents?: Incident[] }>('/api/v1/incidents/queue?status=OPEN&limit=100'))
        .incidents ?? [],
    enabled: canSeeIncidents,
    retry: false,
  });

  const activity = useQuery({
    queryKey: ['dashboard-activity'],
    queryFn: async () =>
      (await api.get<{ entries?: AuditEntry[] }>('/api/v1/audit?scopeType=PLATFORM&limit=8'))
        .entries ?? [],
    enabled: canSeeAudit,
    retry: false,
  });

  const firstName = session.user.fullName.split(' ')[0];
  const total = results.reduce((sum, result) => sum + (result.data?.length ?? 0), 0);
  const settled = results.every((result) => !result.isPending);
  // A queue that failed to load is not a queue that is empty, and "every queue
  // you can work is clear" is exactly the sentence somebody acts on by closing
  // the tab.
  const failed = results.some((result) => result.isError);

  const oldestOverall = results
    .map((result) => (result.data ? oldestOf(result.data) : null))
    .filter((time): time is number => time !== null)
    .sort((a, b) => a - b)[0];

  const severityCounts = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: (incidents.data ?? []).filter((row) => row.severity === severity).length,
  })).filter((entry) => entry.count > 0);

  const worst = [...(incidents.data ?? [])].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  )[0];

  const canSeeFacilityGrowth = session.permissions.includes('facility.read');
  const canSeePractitionerGrowth = session.permissions.includes('practitioner.profile.read');
  const canSeeUsage = session.permissions.includes('audit.read');
  const canSeeGrowth = canSeeFacilityGrowth || canSeePractitionerGrowth || canSeeUsage;

  const facilityGrowth = useQuery({
    queryKey: ['dashboard-growth-facilities'],
    queryFn: () =>
      fetchAllPages<CreatedRow>('/api/v1/facilities?scopeType=PLATFORM&limit=200', (body) => ({
        rows: (body as { facilities?: CreatedRow[] }).facilities ?? [],
        nextCursor: (body as { nextCursor?: string | null }).nextCursor ?? null,
      })),
    enabled: canSeeFacilityGrowth,
    retry: false,
  });

  const practitionerGrowth = useQuery({
    queryKey: ['dashboard-growth-practitioners'],
    queryFn: () =>
      fetchAllPages<CreatedRow>('/api/v1/practitioners?scopeType=PLATFORM&limit=100', (body) => ({
        rows: (body as { practitioners?: CreatedRow[] }).practitioners ?? [],
        nextCursor: (body as { nextCursor?: string | null }).nextCursor ?? null,
      })),
    enabled: canSeePractitionerGrowth,
    retry: false,
  });

  const usageGrowth = useQuery({
    queryKey: ['dashboard-growth-usage'],
    queryFn: () =>
      fetchAllPages<CreatedRow>('/api/v1/audit?scopeType=PLATFORM&limit=200', (body) => ({
        rows: (body as { entries?: CreatedRow[] }).entries ?? [],
        nextCursor: (body as { nextCursor?: string | null }).nextCursor ?? null,
      })),
    enabled: canSeeUsage,
    retry: false,
  });

  const growthLoading =
    (canSeeFacilityGrowth && facilityGrowth.isPending) ||
    (canSeePractitionerGrowth && practitionerGrowth.isPending) ||
    (canSeeUsage && usageGrowth.isPending);

  // One bucket per calendar month, unioned across all three series so a
  // month only one of them has data for still shows a real zero rather than
  // a gap — a gap in a line chart reads as missing data, not as "none".
  const growthSeries = useMemo(() => {
    const buckets = new Map<
      string,
      { month: string; facilities: number; practitioners: number; usage: number }
    >();
    const bump = (rows: CreatedRow[] | undefined, field: 'facilities' | 'practitioners' | 'usage') => {
      for (const row of rows ?? []) {
        const key = monthSortKey(row.createdAt);
        const bucket = buckets.get(key) ?? {
          month: monthLabel(row.createdAt),
          facilities: 0,
          practitioners: 0,
          usage: 0,
        };
        bucket[field] += 1;
        buckets.set(key, bucket);
      }
    };
    bump(facilityGrowth.data, 'facilities');
    bump(practitionerGrowth.data, 'practitioners');
    bump(usageGrowth.data, 'usage');
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  }, [facilityGrowth.data, practitionerGrowth.data, usageGrowth.data]);

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName}`}
        description={
          settled && !failed && total === 0
            ? 'Nothing is waiting on you. Every queue you can work is clear.'
            : 'Everything below is waiting on a person. Nothing in Medilink closes itself.'
        }
      />

      {mine.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            This account holds no queue permissions, so there is nothing to show here. That is the
            grants deciding what you see, not a page failing to load.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* The summary answers "is today bad?" before any individual queue
              does, and the oldest item is the honest measure of that. */}
          {settled && !failed && total > 0 ? (
            <Card className="border-primary/25 bg-accent/40">
              <CardContent className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-6 text-sm">
                <span className="tabular text-2xl font-semibold leading-none">{total}</span>
                <span className="font-medium">
                  {total === 1 ? 'thing is' : 'things are'} waiting on you
                </span>
                {oldestOverall ? (
                  <span className="text-muted-foreground">
                    · the oldest arrived {formatAgo(new Date(oldestOverall).toISOString())}
                  </span>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {mine.map((tile, index) => {
              const result = results[index];
              const rows = result?.data ?? [];
              const count = rows.length;
              const oldest = oldestOf(rows);
              const days = oldest ? (Date.now() - oldest) / 86_400_000 : 0;
              const stale = days >= STALE_AFTER_DAYS;
              const Icon = tile.icon;

              return (
                <Link key={tile.href} href={tile.href} className="group">
                  <Card
                    className={cn(
                      'h-full transition-all hover:border-primary/50 hover:shadow-md',
                      stale && 'border-warning/40',
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
                          <Icon className="size-3.5" />
                        </span>
                        <ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>

                      <p className="mt-3 text-sm font-medium">{tile.label}</p>

                      {result?.isPending ? (
                        <Skeleton className="mt-2 h-7 w-10" />
                      ) : result?.isError ? (
                        <p className="mt-2 text-sm text-destructive">Could not load</p>
                      ) : (
                        <>
                          <p
                            className={cn(
                              'tabular mt-1 text-2xl font-semibold',
                              count === 0 && 'text-muted-foreground',
                            )}
                          >
                            {count}
                          </p>
                          {oldest ? (
                            <p
                              className={cn(
                                'mt-1 text-xs',
                                stale ? 'font-medium text-warning' : 'text-muted-foreground',
                              )}
                            >
                              oldest arrived {formatAgo(new Date(oldest).toISOString())}
                            </p>
                          ) : null}
                        </>
                      )}

                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {tile.hint}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>

          {canSeeGrowth ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="size-4 text-muted-foreground" aria-hidden="true" />
                  Platform growth
                </CardTitle>
                <CardDescription>
                  New facilities, new practitioners and overall activity, by month. A flat or
                  falling line is where growth stalled.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {growthLoading ? (
                  <Skeleton className="h-[260px] w-full" />
                ) : growthSeries.length === 0 ? (
                  <p className="py-20 text-center text-sm text-muted-foreground">
                    Not enough history yet to chart a trend.
                  </p>
                ) : (
                  <ChartContainer config={GROWTH_CHART_CONFIG} className="h-[260px] w-full">
                    <BarChart data={growthSeries} accessibilityLayer>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                      {/* Two axes because registrations run in the tens and
                          activity in the thousands — sharing one would draw
                          the smaller two as a flat line along the bottom. */}
                      <YAxis
                        yAxisId="count"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        width={32}
                        allowDecimals={false}
                      />
                      <YAxis
                        yAxisId="activity"
                        orientation="right"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        width={40}
                        allowDecimals={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <ChartLegend content={<ChartLegendContent />} />
                      {canSeeFacilityGrowth ? (
                        <Bar
                          yAxisId="count"
                          dataKey="facilities"
                          fill="var(--color-facilities)"
                          radius={[4, 4, 0, 0]}
                        />
                      ) : null}
                      {canSeePractitionerGrowth ? (
                        <Bar
                          yAxisId="count"
                          dataKey="practitioners"
                          fill="var(--color-practitioners)"
                          radius={[4, 4, 0, 0]}
                        />
                      ) : null}
                      {canSeeUsage ? (
                        <Bar
                          yAxisId="activity"
                          dataKey="usage"
                          fill="var(--color-usage)"
                          radius={[4, 4, 0, 0]}
                        />
                      ) : null}
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            {canSeeIncidents ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Open incidents by severity</CardTitle>
                </CardHeader>
                <CardContent>
                  {incidents.isPending ? (
                    <Skeleton className="h-24 w-full" />
                  ) : incidents.isError ? (
                    <p className="text-sm text-destructive">Could not load</p>
                  ) : severityCounts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing open.</p>
                  ) : (
                    <>
                      <ul className="space-y-2">
                        {severityCounts.map(({ severity, count }) => (
                          <li key={severity} className="flex items-center gap-3 text-sm">
                            <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {humanise(severity)}
                            </span>
                            <span
                              className={cn(
                                'h-2 rounded-full',
                                severity === 'DEATH' || severity === 'SEVERE'
                                  ? 'bg-destructive'
                                  : severity === 'MODERATE'
                                    ? 'bg-warning'
                                    : 'bg-primary/40',
                              )}
                              style={{
                                width: `${Math.max(8, (count / (incidents.data?.length || 1)) * 160)}px`,
                              }}
                              aria-hidden="true"
                            />
                            <span className="tabular text-sm font-medium">{count}</span>
                          </li>
                        ))}
                      </ul>

                      {worst ? (
                        <div className="mt-4 border-t pt-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Most serious open
                          </p>
                          <p className="mt-1 line-clamp-2 text-sm">{worst.summary}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {humanise(worst.category)} · reported {formatAgo(worst.reportedAt)}
                          </p>
                        </div>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
            ) : null}

            {canSeeAudit ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <History className="size-4 text-muted-foreground" aria-hidden="true" />
                    Recently on the record
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {activity.isPending ? (
                    <Skeleton className="h-24 w-full" />
                  ) : activity.isError ? (
                    <p className="text-sm text-destructive">Could not load</p>
                  ) : (activity.data ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {(activity.data ?? []).map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-baseline justify-between gap-3 text-sm"
                        >
                          <span className="truncate">
                            {humanise(entry.action.replace(/\./g, ' '))}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatAgo(entry.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Said here so nobody goes looking for a filter that is
                      deliberately absent. */}
                  <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                    What happened, not who has been busy. The trail answers what happened to a
                    record and cannot be filtered by person.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
