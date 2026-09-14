'use client';

import { useState } from 'react';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatWhen, shortId } from '@/components/app/format';

interface SubjectRequest {
  id: string;
  userId: string;
  kind: string;
  status: string;
  detail: string | null;
  outcome: string | null;
  receivedAt: string;
  dueBy: string;
  overdue: boolean;
}

const STATUSES = ['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REFUSED'] as const;
const MIN_OUTCOME = 10;

/** What each right actually obliges the platform to do. */
const KIND_DUTY: Record<string, string> = {
  ACCESS: 'They are entitled to a copy of what is held about them.',
  PORTABILITY: 'A copy in a form they can take elsewhere. The export endpoint produces it.',
  RECTIFICATION: 'Something held about them is wrong and has to be corrected.',
  ERASURE:
    'Identifying details are replaced. Audit rows and ledger entries are retained under a legal obligation — tell them that, rather than letting them assume otherwise.',
  RESTRICTION: 'They want processing stopped while something is resolved.',
};

/**
 * Requests from data subjects, closest to their deadline first.
 *
 * The Act expects an answer within a month. Sorting by deadline rather than
 * by arrival is what makes that a queue somebody can work rather than a list
 * that quietly goes stale at the bottom.
 */
export default function DataRequestsPage() {
  const [status, setStatus] = useState<string>('RECEIVED');
  const queueKey = ['data-requests', status];
  const queue = useQueue<SubjectRequest>(
    queueKey,
    `/api/v1/data-requests?status=${status}`,
    (body) => (body as { requests?: SubjectRequest[] }).requests ?? [],
  );

  const [outcomes, setOutcomes] = useState<Record<string, string>>({});

  const close = useQueueAction<{ id: string; status: 'COMPLETED' | 'REFUSED' }>({
    queueKey,
    run: ({ id, status: next }) =>
      api.post(`/api/v1/data-requests/${id}/close`, {
        status: next,
        outcome: outcomes[id]?.trim(),
      }),
    success: ({ status: next }) =>
      next === 'COMPLETED' ? 'Answered' : 'Refused, with the reason on the record',
  });

  const overdue = (queue.data ?? []).filter((row) => row.overdue).length;

  return (
    <>
      <PageHeader
        title="Data requests"
        description="Somebody exercising a right over their own data. The Act expects an answer within a month, so this queue is ordered by deadline rather than by arrival."
      />

      {overdue > 0 ? (
        <Alert variant="destructive" className="mb-6">
          <TriangleAlert />
          <AlertDescription>
            <strong>
              {overdue} request{overdue === 1 ? ' is' : 's are'} past the statutory deadline.
            </strong>{' '}
            Answering late is a breach in its own right, separately from whatever the answer is.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={status} onValueChange={setStatus} className="mb-5">
        <TabsList>
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {humanise(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>This queue could not be loaded.</AlertDescription>
        </Alert>
      ) : queue.data.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title={`Nothing ${humanise(status).toLowerCase()}`}
          description={
            status === 'RECEIVED'
              ? 'A request appears here the moment somebody exercises a right from their privacy page.'
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {queue.data.map((row) => {
            const outcome = outcomes[row.id]?.trim() ?? '';
            const open = row.status === 'RECEIVED' || row.status === 'IN_PROGRESS';

            return (
              <Card key={row.id} className={row.overdue ? 'border-destructive/40' : undefined}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{humanise(row.kind)}</Badge>
                      <StatusBadge status={row.status} />
                      {row.overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      received {formatAgo(row.receivedAt)}
                    </p>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Subject">{shortId(row.userId)}</Detail>
                    <Detail label="Received">{formatWhen(row.receivedAt)}</Detail>
                    <Detail label="Due by" className="sm:col-span-2">
                      <span className={row.overdue ? 'text-destructive' : undefined}>
                        {formatWhen(row.dueBy)}
                      </span>
                    </Detail>
                  </DetailGrid>

                  {row.detail ? (
                    <p className="rounded-md bg-muted px-3 py-2 text-sm">
                      They said: {row.detail}
                    </p>
                  ) : null}

                  <Alert variant="info">
                    <ShieldCheck />
                    <AlertDescription>{KIND_DUTY[row.kind]}</AlertDescription>
                  </Alert>

                  {row.outcome ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Answered
                      </p>
                      <p className="mt-1">{row.outcome}</p>
                    </div>
                  ) : null}

                  {open ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label htmlFor={`outcome-${row.id}`}>
                          What was done{' '}
                          <span className="font-normal text-muted-foreground">
                            — required either way, and the subject reads it
                          </span>
                        </Label>
                        <Textarea
                          id={`outcome-${row.id}`}
                          rows={3}
                          placeholder="What you did, or why you are refusing."
                          value={outcomes[row.id] ?? ''}
                          onChange={(event) =>
                            setOutcomes((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="success"
                          disabled={outcome.length < MIN_OUTCOME || close.isPending}
                          onClick={() => close.mutate({ id: row.id, status: 'COMPLETED' })}
                        >
                          Answered
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={outcome.length < MIN_OUTCOME || close.isPending}
                          onClick={() => close.mutate({ id: row.id, status: 'REFUSED' })}
                        >
                          Refuse
                        </Button>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
