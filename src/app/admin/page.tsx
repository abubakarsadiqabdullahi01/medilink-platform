'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  CircleCheck,
  KeyRound,
  Landmark,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useNow } from '@/lib/ui/now';
import {
  QUEUES,
  opsAttention,
  oldestWaiting,
  queueRows,
  type PlatformSummaryJson,
} from '@/lib/ui/ops-today';
import { useSession } from '@/lib/ui/session';
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
import { QueueAge, waitingFor } from '@/components/app/queue-age';
import { ErrorState } from '@/components/app/states';
import { SeverityBadge, humanise } from '@/components/app/status-badge';
import { actionLabel, formatAgo, formatDate } from '@/components/app/format';

/**
 * Where an operations officer starts: what is late, how long each queue has been left, and the
 * things that stop work or move money.
 *
 * It used to be six tiles, a growth chart and a feed, with one rule — "stale after five days" —
 * for every queue. A death reported four days ago was fine; a suggestion at six days was late. Now:
 *
 *   1. the one primary action: whatever is first on the list below
 *   2. what needs attention, most urgent first (the rules are in lib/ui/ops-today.ts): a missed
 *      legal deadline, a serious incident, a failing background system, a failed reconciliation,
 *      then each queue that has been left too long *for what it is*, then the money awaiting a person
 *   3. five figures: the longest wait, verifications, casework, privacy requests, system health
 *   4. every queue the person may work, longest-waiting first, with its age in words
 *   5. the money, and the actions that ask for the password again
 *
 * Everything is read from the one `/api/v1/dashboard/platform` request. A section the person may
 * not see is absent, never zero. The growth chart is gone: it is the one thing here nobody acts on.
 */
export default function DashboardPage() {
  const session = useSession();
  const now = useNow();

  // One request for every number on the page. The key starts with 'tile', so the invalidation
  // every queue action already does refreshes it too.
  const summary = useQuery({
    queryKey: ['tile', 'platform-summary'],
    queryFn: () => api.get<PlatformSummaryJson>('/api/v1/dashboard/platform'),
    retry: false,
  });
  const data = summary.data;

  const mayWorkAQueue = QUEUES.some((queue) =>
    session.permissions.includes(permissionFor(queue.key)),
  );
  const settled = !summary.isPending;
  // A queue that failed to load is not a queue that is empty, and "every queue you can work is
  // clear" is exactly the sentence somebody acts on by closing the tab.
  const failed = summary.isError;

  const rows = useMemo(() => queueRows(data, now), [data, now]);
  const attention = useMemo(() => opsAttention(data, now), [data, now]);
  const oldest = oldestWaiting(rows);

  const verifications =
    (data?.queues.credentials?.count ?? 0) + (data?.queues.facilities?.count ?? 0);
  const hasVerifications = Boolean(data?.queues.credentials || data?.queues.facilities);
  const casework = (data?.queues.incidents?.count ?? 0) + (data?.queues.disputes?.count ?? 0);
  const hasCasework = Boolean(data?.queues.incidents || data?.queues.disputes);

  const firstName = session.user.fullName.split(' ')[0];
  const primary = attention[0];

  const recent = (data?.recent ?? [])
    .filter((entry) => !entry.action.startsWith('auth.'))
    .slice(0, 5);

  return (
    <>
      <PageHeader
        title="Operations"
        description={`Good day, ${firstName}. Everything below is waiting on a person: nothing in Medilink closes itself.`}
        action={
          settled && primary ? (
            <Link href={primary.href} className={buttonVariants({ size: 'lg' })}>
              {primary.action}
              <ArrowRight />
            </Link>
          ) : null
        }
      />

      {!mayWorkAQueue && !data?.privacy && !data?.health && !data?.money ? (
        <Card>
          <CardContent className="pt-6 text-base text-muted-foreground">
            This account holds no queue permissions, so there is nothing to show here. That is the
            grants deciding what you see, not a page failing to load.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
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
            loading={!settled}
            error={failed && attention.length === 0}
            emptyTitle="Nothing is late"
            emptyDetail="No deadline has been missed, no queue has been left too long, and nothing is waiting on a password."
          />

          <MetricGrid>
            <MetricTile
              label="Longest wait"
              value={oldest?.oldest ? waitingFor(oldest.oldest, now) : '—'}
              hint={oldest ? `${oldest.label}, ${oldest.count} waiting` : 'Every queue is clear'}
              href={oldest?.href}
              tone={
                oldest?.tone === 'overdue'
                  ? 'danger'
                  : oldest?.tone === 'ageing'
                    ? 'warning'
                    : 'neutral'
              }
              icon={ScrollText}
              loading={!settled}
              error={failed}
            />
            {hasVerifications || !settled ? (
              <MetricTile
                label="Verifications"
                value={verifications}
                hint="Credentials and facilities waiting"
                href={data?.queues.credentials ? '/admin/credentials' : '/admin/facilities'}
                icon={ShieldCheck}
                loading={!settled}
                error={failed}
              />
            ) : null}
            {hasCasework || !settled ? (
              <MetricTile
                label="Casework"
                value={casework}
                hint="Incidents and disputes open"
                href={data?.queues.incidents ? '/admin/incidents' : '/admin/disputes'}
                icon={ShieldAlert}
                loading={!settled}
                error={failed}
              />
            ) : null}
            {data?.privacy ? (
              <MetricTile
                label="Data requests"
                value={data.privacy.open}
                hint={
                  data.privacy.overdue > 0
                    ? `${data.privacy.overdue} past the deadline`
                    : data.privacy.nextDue
                      ? `Next due ${formatDate(data.privacy.nextDue)}`
                      : 'None open'
                }
                href="/admin/data-requests"
                tone={data.privacy.overdue > 0 ? 'danger' : 'neutral'}
                icon={KeyRound}
              />
            ) : null}
            {data?.health ? (
              <MetricTile
                label="System health"
                value={data.health.status === 'ok' ? 'Healthy' : `${data.health.problems} wrong`}
                hint={
                  data.health.status === 'ok'
                    ? 'Messages and jobs are going out'
                    : data.health.deadLetter > 0
                      ? `${data.health.deadLetter} events gave up`
                      : 'See the System page'
                }
                href="/admin/system"
                tone={data.health.status === 'ok' ? 'success' : 'danger'}
                icon={Activity}
              />
            ) : null}
          </MetricGrid>

          <div className="grid items-start gap-8 xl:grid-cols-[3fr_2fr]">
            <DashboardSection
              id="queues-heading"
              title="Queues, longest-waiting first"
              description="How long the oldest item in each has waited."
            >
              {!settled ? (
                <Skeleton className="h-48 w-full" />
              ) : failed && rows.length === 0 ? (
                <ErrorState error={summary.error} onRetry={() => void summary.refetch()} compact />
              ) : rows.length === 0 ? (
                <EmptyState
                  compact
                  icon={<CircleCheck />}
                  title="No queues to show"
                  description="This account holds no queue permissions."
                />
              ) : (
                <Card>
                  <ul className="divide-y">
                    {rows.map((row) => (
                      <li key={row.key}>
                        <Link
                          href={row.href}
                          className="grid min-h-16 grid-cols-[1fr_auto] items-center gap-x-4 p-4 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        >
                          <span className="min-w-0">
                            <span className="block font-medium leading-snug">
                              {row.label}{' '}
                              <span className="font-normal text-muted-foreground">{row.noun}</span>
                            </span>
                            {row.count > 0 && row.oldest ? (
                              <QueueAge
                                since={row.oldest}
                                label="Oldest waited"
                                thresholds={row.thresholds}
                              />
                            ) : (
                              <span className="text-sm text-muted-foreground">Nothing waiting</span>
                            )}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="tabular text-2xl font-semibold leading-none">
                              {row.count}
                            </span>
                            <ArrowRight
                              className="size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </DashboardSection>

            <div className="space-y-8">
              {data?.worstIncident ? (
                <DashboardSection
                  id="worst-heading"
                  title="Most serious open incident"
                  href="/admin/incidents"
                  hrefLabel="Incidents"
                >
                  <Card>
                    <CardContent className="space-y-2 pt-6">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={data.worstIncident.severity} />
                        <span className="text-sm text-muted-foreground">
                          {humanise(data.worstIncident.category)}
                        </span>
                      </div>
                      <p className="line-clamp-3 leading-relaxed">{data.worstIncident.summary}</p>
                      <QueueAge
                        since={data.worstIncident.reportedAt}
                        label="Reported"
                        thresholds={{ ageingAfterHours: 4, overdueAfterHours: 24 }}
                      />
                    </CardContent>
                  </Card>
                </DashboardSection>
              ) : null}

              {data?.money || data?.health ? (
                <DashboardSection id="money-heading" title="Money and the system">
                  <Card>
                    <ul className="divide-y text-base">
                      {data.money ? (
                        <li className="flex items-start gap-3 p-4">
                          <Landmark
                            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span>
                            <span className="block font-medium">Nightly reconciliation</span>
                            <span className="text-sm text-muted-foreground">
                              {data.money.reconciliation.lastStatus === null
                                ? 'It has not run yet.'
                                : data.money.reconciliation.lastStatus === 'SUCCEEDED'
                                  ? `Last ran ${formatAgo(data.money.reconciliation.lastRunAt)}; the books added up.`
                                  : `Last ran ${formatAgo(data.money.reconciliation.lastRunAt)} and failed.`}
                            </span>
                          </span>
                        </li>
                      ) : null}
                      {data.money?.payoutsPrepared ? (
                        <li>
                          <Link
                            href="/admin/payouts"
                            className="block p-4 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          >
                            <span className="block font-medium">
                              {data.money.payoutsPrepared.count} payouts prepared
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {data.money.payoutsReleased?.count ?? 0} released, waiting for the
                              transfer to be recorded
                            </span>
                          </Link>
                        </li>
                      ) : null}
                      {data.money?.draftInvoices ? (
                        <li>
                          <Link
                            href="/admin/invoices"
                            className="block p-4 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          >
                            <span className="block font-medium">
                              {data.money.draftInvoices.count} invoices drafted
                            </span>
                            <span className="text-sm text-muted-foreground">
                              Not yet issued to a facility
                            </span>
                          </Link>
                        </li>
                      ) : null}
                      {data.health ? (
                        <li className="flex items-start gap-3 p-4">
                          <Activity
                            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span>
                            <span className="block font-medium">Texts and background jobs</span>
                            <span className="text-sm text-muted-foreground">
                              {data.health.failedTexts24h} failed in the last day ·{' '}
                              {data.health.deadLetter} events gave up
                            </span>
                          </span>
                        </li>
                      ) : null}
                    </ul>
                  </Card>
                </DashboardSection>
              ) : null}

              {data?.money || data?.privacy ? (
                <DashboardSection id="elevated-heading" title="Actions that ask for your password">
                  <Card>
                    <CardContent className="space-y-2 pt-6 text-base">
                      <p className="flex items-start gap-2">
                        <KeyRound
                          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span>
                          {session.stepUpFresh
                            ? 'You confirmed your password recently, so these will go through without asking again for a few minutes.'
                            : 'You will be asked for your password before any of these.'}
                        </span>
                      </p>
                      <ul className="list-disc space-y-1 pl-9 text-muted-foreground">
                        {data.money?.payoutsPrepared ? <li>Releasing a payout</li> : null}
                        {data.money?.draftInvoices ? (
                          <li>Issuing an invoice, or recording that one was paid</li>
                        ) : null}
                        {data.privacy ? (
                          <li>
                            Carrying out an erasure
                            {data.privacy.erasures > 0 ? ` (${data.privacy.erasures} waiting)` : ''}
                          </li>
                        ) : null}
                      </ul>
                    </CardContent>
                  </Card>
                </DashboardSection>
              ) : null}

              {recent.length > 0 ? (
                <DashboardSection
                  id="recent-heading"
                  title="Recently on the record"
                  href="/admin/audit"
                  hrefLabel="Audit trail"
                >
                  <Card>
                    <ul className="divide-y">
                      {recent.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-baseline justify-between gap-3 px-4 py-3"
                        >
                          <span>{actionLabel(entry.action)}</span>
                          <span className="shrink-0 text-sm text-muted-foreground">
                            {formatAgo(entry.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="border-t px-4 py-3 text-sm text-muted-foreground">
                      What happened to a record, not who has been busy. Sign-ins are not listed.
                    </p>
                  </Card>
                </DashboardSection>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The permission a queue needs, as its own endpoint asks for it (see QUEUE_PERMISSION on the server). */
function permissionFor(key: string): string {
  return (
    {
      credentials: 'credential.review',
      facilities: 'facility.verify',
      incidents: 'incident.manage',
      disputes: 'dispute.manage',
      unhonoured: 'sanction.apply',
      suggestions: 'suggestion.triage',
    } as Record<string, string>
  )[key]!;
}
