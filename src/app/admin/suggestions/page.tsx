'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo } from '@/components/app/format';

interface Suggestion {
  id: string;
  source: string;
  raisedBy: string | null;
  area: string;
  body: string;
  sourceRef: string | null;
  status: string;
  response: string | null;
  createdAt: string;
}

interface AreaCount {
  area: string;
  total: number;
  open: number;
}

const STATUSES = ['NEW', 'TRIAGED', 'PLANNED', 'DONE', 'DECLINED'] as const;
const MIN_RESPONSE = 10;

export default function SuggestionsPage() {
  const [status, setStatus] = useState<string>('NEW');
  const queueKey = ['suggestions', status];
  const queue = useQueue<Suggestion>(
    queueKey,
    `/api/v1/suggestions?status=${status}`,
    (body) => (body as { suggestions?: Suggestion[] }).suggestions ?? [],
  );

  const summary = useQuery({
    queryKey: ['suggestions-summary'],
    queryFn: () => api.get<{ areas: AreaCount[] }>('/api/v1/suggestions/summary'),
  });

  const [response, setResponse] = useState<Record<string, string>>({});

  const triage = useQueueAction<{ id: string; status: string }>({
    queueKey,
    run: ({ id, status: next }) =>
      api.post(`/api/v1/suggestions/${id}/triage`, {
        status: next,
        response: response[id]?.trim() || undefined,
      }),
    success: ({ status: next }) => `Marked ${next.toLowerCase()}`,
  });

  const busiest = Math.max(1, ...(summary.data?.areas.map((row) => row.total) ?? [1]));

  return (
    <>
      <PageHeader
        title="Suggestions"
        description="What people said did not work. Decline reasons land here automatically and without the practitioner's name on them, because they were answering an invitation rather than filing a complaint."
      />

      {summary.data && summary.data.areas.length > 0 ? (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Where the complaints are</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {summary.data.areas.map((row) => (
              <div key={row.area} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 truncate text-muted-foreground">
                  {humanise(row.area)}
                </span>
                {/* A bar, because the useful reading is the comparison and a
                    column of numbers does not give you one at a glance. */}
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(row.total / busiest) * 100}%` }}
                  />
                </div>
                <span className="tabular w-16 shrink-0 text-right text-xs text-muted-foreground">
                  {row.total}
                  {row.open > 0 ? ` · ${row.open} open` : ''}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Tabs value={status} onValueChange={setStatus} className="mb-5">
        <TabsList>
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {value.toLowerCase()}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {queue.isPending ? (
        <QueueSkeleton rows={2} />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>This queue could not be loaded.</AlertDescription>
        </Alert>
      ) : queue.data.length === 0 ? (
        <EmptyState icon={<MessageSquareText />} title={`Nothing ${status.toLowerCase()}`} />
      ) : (
        <div className="space-y-4">
          {queue.data.map((row) => {
            const answer = response[row.id]?.trim() ?? '';
            const closed = ['DONE', 'DECLINED'].includes(row.status);
            const canClose = answer.length >= MIN_RESPONSE;

            return (
              <Card key={row.id}>
                <CardHeader className="space-y-3 pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{humanise(row.area)}</Badge>
                    <StatusBadge status={row.status} />
                    {row.source === 'DECLINE_REASON' ? (
                      <Badge variant="warning">From a declined invitation</Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{formatAgo(row.createdAt)}</span>
                  </div>
                  <p className="text-sm leading-relaxed">{row.body}</p>
                </CardHeader>

                <CardContent className="space-y-4">
                  {row.response ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Answered
                      </p>
                      <p className="mt-1">{row.response}</p>
                    </div>
                  ) : null}

                  {closed ? null : (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label htmlFor={`response-${row.id}`}>
                          Answer{' '}
                          <span className="font-normal text-muted-foreground">
                            — required to mark it done or declined
                          </span>
                        </Label>
                        <Textarea
                          id={`response-${row.id}`}
                          rows={2}
                          placeholder="What was done, or why it will not be."
                          value={response[row.id] ?? ''}
                          onChange={(event) =>
                            setResponse((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {row.status === 'NEW' ? (
                          <Button
                            variant="outline"
                            disabled={triage.isPending}
                            onClick={() => triage.mutate({ id: row.id, status: 'TRIAGED' })}
                          >
                            Triaged
                          </Button>
                        ) : null}
                        {row.status !== 'PLANNED' ? (
                          <Button
                            variant="outline"
                            disabled={triage.isPending}
                            onClick={() => triage.mutate({ id: row.id, status: 'PLANNED' })}
                          >
                            Planned
                          </Button>
                        ) : null}
                        <Button
                          variant="success"
                          disabled={!canClose || triage.isPending}
                          onClick={() => triage.mutate({ id: row.id, status: 'DONE' })}
                        >
                          Done
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!canClose || triage.isPending}
                          onClick={() => triage.mutate({ id: row.id, status: 'DECLINED' })}
                        >
                          Decline
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
