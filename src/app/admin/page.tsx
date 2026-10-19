'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
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
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { humanise } from '@/components/app/status-badge';
import { NeedsBanner, StatTile } from '@/components/app/dashboard';
import { ICON } from '@/components/app/icons';
import { PageHeader } from '@/components/app/page-shell';
import { actionLabel, formatAgo } from '@/components/app/format';

/**
 * What is waiting, how long it has been waiting, and what happened recently.
 *
 * Everything on this page comes from one request, `/api/v1/dashboard/platform`,
 * which counts in the database. It used to download each queue to take its
 * length, and page through the whole audit trail to draw the growth chart —
 * dozens of requests and thousands of rows to show about thirty numbers, which
 * is most of what made opening the console feel slow. The count still carries
 * *how old* the oldest item is, which is the part a number alone never tells
 * you: eleven credentials waiting an hour is a normal morning, and one waiting
 * nine days is somebody who has given up on us.
 */

type QueueKey = 'credentials' | 'facilities' | 'incidents' | 'disputes' | 'unhonoured' | 'suggestions';

/** The shape of /api/v1/dashboard/platform; dates arrive as ISO strings. */
interface Summary {
  queues: Partial<Record<QueueKey, { count: number; oldest: string | null }>>;
  incidentSeverity: { severity: string; count: number }[];
  worstIncident: { severity: string; category: string; summary: string; reportedAt: string } | null;
  growth: { month: string; facilities: number; practitioners: number; usage: number }[];
  recent: { id: string; action: string; createdAt: string }[];
}

interface Tile {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: string;
  queue: QueueKey;
  hint: string;
}

const TILES: Tile[] = [
  {
    href: '/admin/credentials',
    label: 'Credentials to review',
    icon: FileCheck2,
    permission: 'credential.review',
    queue: 'credentials',
    hint: 'A practitioner is ineligible until every mandatory credential is verified.',
  },
  {
    href: '/admin/facilities',
    label: 'Facilities to verify',
    icon: Building2,
    permission: 'facility.verify',
    queue: 'facilities',
    hint: 'An unverified facility cannot publish a shift.',
  },
  {
    href: '/admin/incidents',
    label: 'Clinical incidents open',
    icon: Stethoscope,
    permission: 'incident.manage',
    queue: 'incidents',
    hint: 'Most serious first. A death outranks a near miss from March.',
  },
  {
    href: '/admin/disputes',
    label: 'Disputes to adjudicate',
    icon: Gavel,
    permission: 'dispute.manage',
    queue: 'disputes',
    hint: 'A decided shift the two sides disagree about.',
  },
  {
    href: '/admin/unhonoured',
    label: 'Shifts awaiting fault',
    icon: FileClock,
    permission: 'sanction.apply',
    queue: 'unhonoured',
    hint: 'A sweep flags these. Only a person can close one.',
  },
  {
    href: '/admin/suggestions',
    label: 'Suggestions untriaged',
    icon: MessageSquareText,
    permission: 'suggestion.triage',
    queue: 'suggestions',
    hint: 'What the pilot is telling you, decline reasons included.',
  },
];

/**
 * Practitioners who have said "review me". It is the pilot's main work item and the one tile the
 * summary request cannot carry (UXO-07), so it asks the directory for the first fifty and takes
 * the count and the oldest from them. Fifty is more than a queue of this kind should ever hold;
 * past it the tile says so rather than quietly stopping at fifty.
 */
const WAITING_LIMIT = 50;

/** Past a working week, something has gone wrong with the queue, not the row. */
const STALE_AFTER_DAYS = 5;

const SEVERITY_ORDER = ['DEATH', 'SEVERE', 'MODERATE', 'MINOR', 'NEAR_MISS'];



/** Whole days since an ISO time, 0 when there is none. */
function daysSince(iso: string | null): number {
  return iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : 0;
}

/** "2026-10" as Oct 26. Parsed by hand: `new Date('2026-10')` is UTC and can land in the previous month. */
function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[(month ?? 1) - 1]} ${String(year).slice(-2)}`;
}

/**
 * The charting library is the heaviest thing on this page and nothing above the
 * fold needs it, so it loads after the tiles and the navigation have appeared,
 * as its own chunk. Skipped on the server: a chart has no meaning before there
 * is data to draw.
 */
const GrowthChart = dynamic(() => import('./growth-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});

export default function DashboardPage() {
  const session = useSession();
  const mine = TILES.filter((tile) => session.permissions.includes(tile.permission));

  // One request for every number on the page. The key starts with 'tile', so
  // the invalidation every queue action already does refreshes it too.
  const summary = useQuery({
    queryKey: ['tile', 'platform-summary'],
    queryFn: () => api.get<Summary>('/api/v1/dashboard/platform'),
    retry: false,
  });
  const data = summary.data;

  const canReviewPractitioners = session.permissions.includes('credential.review');
  const waiting = useQuery({
    queryKey: ['tile', 'practitioners-waiting'],
    queryFn: () =>
      api.get<{
        practitioners?: { submittedForReviewAt: string | null }[];
        nextCursor?: string | null;
      }>(`/api/v1/practitioners?scopeType=PLATFORM&limit=${WAITING_LIMIT}&application=waiting`),
    enabled: canReviewPractitioners,
    retry: false,
  });
  const waitingRows = waiting.data?.practitioners ?? [];
  const waitingOldest =
    waitingRows
      .map((row) => row.submittedForReviewAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;

  const canSeeIncidents = session.permissions.includes('incident.manage');
  const canSeeAudit = session.permissions.includes('audit.read');
  const canSeeFacilityGrowth = session.permissions.includes('facility.read');
  const canSeePractitionerGrowth = session.permissions.includes('practitioner.profile.read');
  const canSeeUsage = canSeeAudit;
  const canSeeGrowth = canSeeFacilityGrowth || canSeePractitionerGrowth || canSeeUsage;

  const firstName = session.user.fullName.split(' ')[0];
  const queues = data?.queues ?? {};
  const total =
    mine.reduce((sum, tile) => sum + (queues[tile.queue]?.count ?? 0), 0) +
    (canReviewPractitioners ? waitingRows.length : 0);
  const settled = !summary.isPending && (!canReviewPractitioners || !waiting.isPending);
  // A queue that failed to load is not a queue that is empty, and "every queue
  // you can work is clear" is exactly the sentence somebody acts on by closing
  // the tab.
  const failed = summary.isError || (canReviewPractitioners && waiting.isError);

  const oldestOverall = [
    ...mine.map((tile) => queues[tile.queue]?.oldest),
    canReviewPractitioners ? waitingOldest : null,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .sort((a, b) => a - b)[0];

  const incidentTotal = (data?.incidentSeverity ?? []).reduce((sum, row) => sum + row.count, 0);
  const severityCounts = SEVERITY_ORDER.map((severity) => ({
    severity,
    count: data?.incidentSeverity.find((row) => row.severity === severity)?.count ?? 0,
  })).filter((entry) => entry.count > 0);
  const worst = data?.worstIncident ?? null;

  const growthLoading = summary.isPending;
  const growthSeries = useMemo(
    () => (data?.growth ?? []).map((row) => ({ ...row, month: monthLabel(row.month) })),
    [data?.growth],
  );

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
          <NeedsBanner
            ready={settled && !failed}
            count={total}
            oldest={oldestOverall ? new Date(oldestOverall).toISOString() : null}
          />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {/* First, because it is first in the pilot's work: nothing else can happen to a
                practitioner until somebody approves them. */}
            {canReviewPractitioners ? (
              <StatTile
                href="/admin/practitioners"
                icon={ICON.practitioner}
                label="Practitioners to approve"
                value={waitingRows.length}
                note={
                  waitingOldest
                    ? `oldest arrived ${formatAgo(waitingOldest)}${waiting.data?.nextCursor ? ` · first ${WAITING_LIMIT} counted` : ''}`
                    : undefined
                }
                stale={daysSince(waitingOldest) >= STALE_AFTER_DAYS}
                hint="Submitted for review. They cannot be offered a shift until an officer approves them."
                isPending={waiting.isPending}
                isError={waiting.isError}
              />
            ) : null}

            {mine.map((tile) => {
              const entry = queues[tile.queue];
              const days = daysSince(entry?.oldest ?? null);

              return (
                <StatTile
                  key={tile.href}
                  href={tile.href}
                  icon={tile.icon}
                  label={tile.label}
                  value={entry?.count ?? 0}
                  note={entry?.oldest ? `oldest arrived ${formatAgo(entry.oldest)}` : undefined}
                  stale={days >= STALE_AFTER_DAYS}
                  hint={tile.hint}
                  isPending={summary.isPending}
                  isError={summary.isError}
                />
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
                  <GrowthChart
                    series={growthSeries}
                    facilities={canSeeFacilityGrowth}
                    practitioners={canSeePractitionerGrowth}
                    usage={canSeeUsage}
                  />
                )}
              </CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            {canSeeIncidents ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Open incidents by severity</CardTitle>
                </CardHeader>
                <CardContent>
                  {summary.isPending ? (
                    <Skeleton className="h-24 w-full" />
                  ) : summary.isError ? (
                    <p className="text-sm text-destructive-text">Could not load</p>
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
                                width: `${Math.max(8, (count / (incidentTotal || 1)) * 160)}px`,
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
                  {summary.isPending ? (
                    <Skeleton className="h-24 w-full" />
                  ) : summary.isError ? (
                    <p className="text-sm text-destructive-text">Could not load</p>
                  ) : (data?.recent ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {(data?.recent ?? []).map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-baseline justify-between gap-3 text-sm"
                        >
                          <span className="min-w-0 break-words">
                            {actionLabel(entry.action)}
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
