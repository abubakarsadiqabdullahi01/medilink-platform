'use client';

import { useState } from 'react';
import { FileCheck2, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatDate, shortId } from '@/components/app/format';

interface Submission {
  id: string;
  userId: string;
  credentialTypeId: string;
  status: string;
  reference: string | null;
  expiresAt: string | null;
  createdAt: string;
  reviewNotes: string | null;
}

const STATUSES = ['PENDING', 'INFO_REQUESTED', 'VERIFIED', 'REJECTED'] as const;

/**
 * Credential review — step 5.2.
 *
 * Three outcomes, not two. Rejecting a nurse because a photograph was blurred
 * is how a platform loses a nurse, and "ask for more" is the middle answer
 * that keeps the submission open instead of making them start again.
 */
export default function CredentialsPage() {
  const [status, setStatus] = useState<string>('PENDING');
  const queueKey = ['credentials', status];
  const queue = useQueue<Submission>(
    queueKey,
    `/api/v1/credentials?scopeType=PLATFORM&status=${status}`,
    (body) => (body as { submissions?: Submission[] }).submissions ?? [],
  );

  const [notes, setNotes] = useState<Record<string, string>>({});

  const review = useQueueAction<{
    id: string;
    decision: 'approve' | 'reject' | 'request_info';
  }>({
    queueKey,
    run: ({ id, decision }) =>
      api.post(`/api/v1/credentials/${id}/review`, {
        decision,
        reviewNotes: notes[id]?.trim() || undefined,
      }),
    success: ({ decision }) =>
      decision === 'approve'
        ? 'Credential verified'
        : decision === 'reject'
          ? 'Credential rejected'
          : 'More information requested',
  });

  return (
    <>
      <PageHeader
        title="Credentials"
        description="A practitioner stays ineligible until every mandatory credential for their category is verified — so this queue is the one that decides who can be matched."
      />

      <Tabs value={status} onValueChange={setStatus} className="mb-5">
        <TabsList>
          {STATUSES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {value === 'INFO_REQUESTED' ? 'Info requested' : value.toLowerCase()}
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
          icon={<FileCheck2 />}
          title={status === 'PENDING' ? 'Nothing waiting' : `No ${status.toLowerCase()} submissions`}
          description={
            status === 'PENDING'
              ? 'Every submission has been reviewed. New ones appear here the moment a practitioner uploads.'
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {queue.data.map((row) => {
            const note = notes[row.id]?.trim() ?? '';
            const open = row.status === 'PENDING' || row.status === 'INFO_REQUESTED';

            return (
              <Card key={row.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <p className="font-medium">{row.reference ?? 'No reference given'}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Submitted {formatAgo(row.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Practitioner">{shortId(row.userId)}</Detail>
                    <Detail label="Credential type">{shortId(row.credentialTypeId)}</Detail>
                    <Detail label="Expires">{formatDate(row.expiresAt)}</Detail>
                    <Detail label="Submitted">{formatDate(row.createdAt)}</Detail>
                  </DetailGrid>

                  {row.reviewNotes ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Last note
                      </p>
                      <p className="mt-1">{row.reviewNotes}</p>
                    </div>
                  ) : null}

                  {open ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label htmlFor={`notes-${row.id}`}>
                          Reason{' '}
                          <span className="font-normal text-muted-foreground">
                            — required to reject or to ask for more
                          </span>
                        </Label>
                        <Textarea
                          id={`notes-${row.id}`}
                          rows={2}
                          placeholder="What is wrong, or what is missing."
                          value={notes[row.id] ?? ''}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="success"
                          loading={review.isPending && review.variables?.id === row.id}
                          onClick={() => review.mutate({ id: row.id, decision: 'approve' })}
                        >
                          Verify
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!note || review.isPending}
                          onClick={() => review.mutate({ id: row.id, decision: 'request_info' })}
                        >
                          Ask for more
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!note || review.isPending}
                          onClick={() => review.mutate({ id: row.id, decision: 'reject' })}
                        >
                          Reject
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
