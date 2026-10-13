'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useCan } from '@/lib/ui/session';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader, QueueSkeleton } from '@/components/app/page-shell';
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

  const system = useQuery({
    queryKey: ['system-status'],
    queryFn: () => api.get<Payload>('/api/v1/admin/system'),
    // A page that is open to see whether something has been fixed should notice.
    refetchInterval: 30_000,
  });

  const replay = useMutation({
    mutationFn: (event: TroubledEvent) => api.post(`/api/v1/admin/system/events/${event.id}/replay`),
    onSuccess: () => {
      toast.success('Queued again', { description: 'The worker will try it on its next pass.' });
      void queryClient.invalidateQueries({ queryKey: ['system-status'] });
    },
    onError: (error) => toast.error('Could not replay it', { description: errorMessage(error) }),
  });

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
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>The system status could not be loaded.</AlertDescription>
          </Alert>
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
                <CardTitle className="text-sm">Events that failed or gave up</CardTitle>
                <CardDescription className="text-xs">
                  An event is retried on its own; one that gave up needs somebody to read why, fix
                  it, and replay it. Replaying runs it again, including any text it sends.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {system.data.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing has failed.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Tried</TableHead>
                        <TableHead>Why</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {system.data.events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="text-xs">
                            <p className="font-mono">{event.eventType}</p>
                            <p className="text-muted-foreground">{formatWhen(event.createdAt)}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant={event.status === 'DEAD_LETTER' ? 'destructive' : 'secondary'}>
                              {event.status === 'DEAD_LETTER' ? 'Gave up' : 'Retrying'}
                            </Badge>
                          </TableCell>
                          <TableCell className="tabular text-xs">{event.attempts}</TableCell>
                          <TableCell className="max-w-md text-xs text-muted-foreground">
                            {event.lastError ?? '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {canReplay ? (
                              <Button
                                variant="outline"
                                size="sm"
                                loading={replay.isPending && replay.variables?.id === event.id}
                                onClick={() => replay.mutate(event)}
                              >
                                Replay
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Scheduled jobs</CardTitle>
                <CardDescription className="text-xs">
                  The checks that run on a timer: expiry, reminders, and the one that notices an
                  absence.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Job</TableHead>
                      <TableHead>Last run</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Next</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {system.data.jobs.map((job) => (
                      <TableRow key={job.key}>
                        <TableCell className="text-xs">
                          <p className="font-mono">{job.key}</p>
                          <p className="text-muted-foreground">{job.description}</p>
                        </TableCell>
                        <TableCell className="text-xs">{formatWhen(job.lastRunAt)}</TableCell>
                        <TableCell className="text-xs">
                          {!job.enabled ? (
                            <Badge variant="outline">Switched off</Badge>
                          ) : job.lastStatus === 'FAILED' ? (
                            <span className="text-destructive">Failed{job.lastError ? `: ${job.lastError}` : ''}</span>
                          ) : job.lastStatus === 'SUCCEEDED' ? (
                            'Succeeded'
                          ) : (
                            'Not run yet'
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{formatWhen(job.nextRunAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
