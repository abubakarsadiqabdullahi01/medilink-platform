'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useCan } from '@/lib/ui/session';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DataTable, type Column } from '@/components/app/data-table';
import { PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { formatWhen } from '@/components/app/format';

interface Problem {
  key: string;
  severity: 'critical' | 'warning';
  message: string;
  subject?: string;
}

interface TroubledEvent {
  id: string;
  eventType: string;
  aggregateType: string;
  status: 'DEAD_LETTER' | 'FAILED';
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

interface Job {
  key: string;
  description: string;
  enabled: boolean;
  intervalSeconds: number;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: 'SUCCEEDED' | 'FAILED' | null;
  lastError: string | null;
  failureCount: number;
}

interface Payload {
  status: 'ok' | 'degraded';
  problems: Problem[];
  outbox: { pending: number; failed: number; deadLetter: number };
  messages: {
    receiptsEnabled: boolean;
    failedOver24h: number;
    failedAfterAccepted24h: number;
    unconfirmed: number | null;
  };
  jobs: Job[];
  events: TroubledEvent[];
}

/**
 * Whether the background work is getting done.
 *
 * Texts, reminders, expiry sweeps and the check that notices an absence are all
 * done by a worker that fails quietly: an event it gave up on, or a worker that
 * is not running, looks like nothing happening. This page is where that shows.
 */
export default function SystemPage() {
  const queryClient = useQueryClient();
  const canReplay = useCan('system.manage');
  const [replaying, setReplaying] = useState<TroubledEvent | null>(null);

  const system = useQuery({
    queryKey: ['system-status'],
    queryFn: () => api.get<Payload>('/api/v1/admin/system'),
    // A page that is open to see whether something has been fixed should notice.
    refetchInterval: 30_000,
  });

  const replay = useMutation({
    mutationFn: (event: TroubledEvent) =>
      api.post(`/api/v1/admin/system/events/${event.id}/replay`),
    onSuccess: () => {
      toast.success('Queued again', { description: 'The worker will try it on its next pass.' });
      setReplaying(null);
      void queryClient.invalidateQueries({ queryKey: ['system-status'] });
    },
    onError: (error) => toast.error('Could not replay it', { description: errorMessage(error) }),
  });

  const eventColumns: Column<TroubledEvent>[] = [
    {
      id: 'event',
      header: 'Event',
      role: 'identity',
      cell: (event) => (
        <>
          <span className="block font-mono text-base">{event.eventType}</span>
          <span className="block text-sm font-normal text-muted-foreground">
            {formatWhen(event.createdAt)}
          </span>
        </>
      ),
    },
    {
      id: 'state',
      header: 'State',
      role: 'status',
      cell: (event) => (
        <Badge variant={event.status === 'DEAD_LETTER' ? 'destructive' : 'secondary'}>
          {event.status === 'DEAD_LETTER' ? 'Gave up' : 'Retrying'}
        </Badge>
      ),
    },
    { id: 'tried', header: 'Tried', numeric: true, cell: (event) => event.attempts },
    {
      id: 'why',
      header: 'Why',
      cell: (event) => (
        <span className="text-muted-foreground [overflow-wrap:anywhere]">
          {event.lastError ?? '—'}
        </span>
      ),
    },
  ];

  const jobColumns: Column<Job>[] = [
    {
      id: 'job',
      header: 'Job',
      role: 'identity',
      cell: (job) => (
        <>
          <span className="block font-mono text-base">{job.key}</span>
          {/* In full beside the table; behind a disclosure on a phone, where fourteen of these
              paragraphs would otherwise be most of the page. */}
          <span className="hidden text-sm font-normal text-muted-foreground md:block">
            {job.description}
          </span>
          <details className="mt-1 md:hidden">
            <summary className="flex min-h-11 cursor-pointer items-center text-base font-normal text-primary">
              What it does
            </summary>
            <span className="block text-base font-normal text-muted-foreground">
              {job.description}
            </span>
          </details>
        </>
      ),
    },
    {
      id: 'result',
      header: 'Result',
      role: 'status',
      cell: (job) =>
        !job.enabled ? (
          <Badge variant="outline">Switched off</Badge>
        ) : job.lastStatus === 'FAILED' ? (
          <Badge variant="destructive">Failed</Badge>
        ) : job.lastStatus === 'SUCCEEDED' ? (
          <Badge variant="success">Succeeded</Badge>
        ) : (
          <Badge variant="secondary">Not run yet</Badge>
        ),
    },
    { id: 'last', header: 'Last run', cell: (job) => formatWhen(job.lastRunAt) },
    { id: 'next', header: 'Next', cell: (job) => formatWhen(job.nextRunAt) },
    {
      id: 'error',
      header: 'Last error',
      cell: (job) =>
        job.lastStatus === 'FAILED' && job.lastError ? (
          <span className="text-destructive-text [overflow-wrap:anywhere]">{job.lastError}</span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="System health"
        description="Whether texts, reminders and the scheduled checks are getting done. Refreshes every half minute."
      />

      <div className="space-y-6">
        {system.isPending ? (
          <QueueSkeleton rows={3} />
        ) : system.isError ? (
          <ErrorState
            error={system.error}
            onRetry={() => void system.refetch()}
            retrying={system.isFetching}
          />
        ) : (
          <>
            {system.data.problems.length === 0 ? (
              <Alert variant="info">
                <CircleCheck />
                <AlertDescription>
                  Background work is getting done: the worker is delivering events, every scheduled
                  job is running on time, and nothing has given up.
                </AlertDescription>
              </Alert>
            ) : (
              system.data.problems.map((problem) => (
                <Alert
                  key={`${problem.key}:${problem.subject ?? ''}`}
                  variant={problem.severity === 'critical' ? 'destructive' : 'warning'}
                >
                  <TriangleAlert />
                  <AlertTitle>
                    {problem.severity === 'critical' ? 'Needs attention now' : 'Needs a look'}
                  </AlertTitle>
                  <AlertDescription>{problem.message}</AlertDescription>
                </Alert>
              ))
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ['Waiting to be delivered', system.data.outbox.pending],
                ['Failed, being retried', system.data.outbox.failed],
                ['Gave up', system.data.outbox.deadLetter],
              ].map(([label, value]) => (
                <Card key={label as string}>
                  <CardContent className="pt-6">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Texts in the last 24 hours</CardTitle>
                <CardDescription className="text-xs">
                  A text counts as sent once a gateway has taken it. These say what happened to the
                  ones that did not go smoothly. Nothing here pages anybody.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  {(
                    [
                      [
                        'Taken by the second gateway',
                        system.data.messages.failedOver24h,
                        'The first gateway failed and the second took them. A text can arrive twice when this happens.',
                      ],
                      [
                        'Taken, then reported failed',
                        system.data.messages.failedAfterAccepted24h,
                        'A gateway accepted them and then said it could not deliver them.',
                      ],
                      [
                        'Taken, no report yet',
                        system.data.messages.unconfirmed,
                        system.data.messages.receiptsEnabled
                          ? 'Taken more than half an hour ago and not yet reported delivered.'
                          : 'Not known: no gateway has been asked to send reports.',
                      ],
                    ] as [string, number | null, string][]
                  ).map(([label, value, note]) => (
                    <div key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="tabular mt-1 text-2xl font-semibold">{value ?? 'Unknown'}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <section aria-labelledby="failed-events-heading" className="space-y-3">
              <div>
                <h2 id="failed-events-heading" className="text-base font-semibold">
                  Events that failed or gave up
                </h2>
                <p className="mt-1 text-base text-muted-foreground">
                  An event is retried on its own; one that gave up needs somebody to read why, fix
                  it, and replay it. Replaying runs it again, including any text it sends.
                </p>
              </div>
              {system.data.events.length === 0 ? (
                <Card className="px-5 py-4">
                  <p className="flex items-center gap-2 text-base text-muted-foreground">
                    <CircleCheck className="size-5 text-success" aria-hidden="true" />
                    Nothing has failed.
                  </p>
                </Card>
              ) : (
                <DataTable
                  caption="Events that failed or gave up"
                  rows={system.data.events}
                  columns={eventColumns}
                  getKey={(event) => event.id}
                  actionHeader=""
                  action={
                    canReplay
                      ? (event) => (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Replay ${event.eventType}`}
                            loading={replay.isPending && replay.variables?.id === event.id}
                            onClick={() => setReplaying(event)}
                          >
                            Replay
                          </Button>
                        )
                      : undefined
                  }
                />
              )}
            </section>

            <section aria-labelledby="scheduled-jobs-heading" className="space-y-3">
              <div>
                <h2 id="scheduled-jobs-heading" className="text-base font-semibold">
                  Scheduled jobs
                </h2>
                <p className="mt-1 text-base text-muted-foreground">
                  The checks that run on a timer: expiry, reminders, and the one that notices an
                  absence.
                </p>
              </div>
              <DataTable
                caption="Scheduled jobs"
                rows={system.data.jobs}
                columns={jobColumns}
                getKey={(job) => job.key}
              />
            </section>
          </>
        )}
      </div>

      <ConfirmDialog
        open={replaying !== null}
        onOpenChange={(next) => !next && setReplaying(null)}
        title="Replay this event"
        object={
          replaying
            ? `${replaying.eventType} · ${replaying.aggregateType} · ${replaying.attempts} ${replaying.attempts === 1 ? 'attempt' : 'attempts'} so far`
            : ''
        }
        consequence="It is queued again and the worker runs it on its next pass, including any text it sends. If the first attempt reached the person, they may receive it twice."
        reversible={false}
        confirmLabel="Replay event"
        loading={replay.isPending}
        onConfirm={() => replaying && replay.mutate(replaying)}
      >
        {replaying?.lastError ? (
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            It last failed with: {replaying.lastError}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
