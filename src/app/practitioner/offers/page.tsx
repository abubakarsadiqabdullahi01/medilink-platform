'use client';

import { useState } from 'react';
import { Inbox, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatWhen, shortId } from '@/components/app/format';

interface Invitation {
  id: string;
  serviceRequestId: string;
  userId: string;
  status: string;
  expiresAt: string;
  declineReason: string | null;
  createdAt: string;
}

/**
 * Offers, and answering them.
 *
 * **Accepting is not being confirmed**, and the card says so: the facility
 * still has to confirm, and a practitioner who thinks they have a shift when
 * they do not is how a ward ends up short at 6am.
 *
 * A decline needs a reason, and the reason is not a formality — declines feed
 * the pilot's suggestion log, without the practitioner's name attached, and
 * are the main way anybody learns the rate is too low or the notice too
 * short.
 */
export default function OffersPage() {
  const queueKey = ['invitations'];
  const queue = useQueue<Invitation>(queueKey, '/api/v1/invitations', (body) => (body as { invitations?: Invitation[] }).invitations ?? []);

  const [reasons, setReasons] = useState<Record<string, string>>({});

  const respond = useQueueAction<{ id: string; decision: 'accept' | 'decline' }>({
    queueKey,
    run: ({ id, decision }) =>
      api.post(`/api/v1/invitations/${id}/respond`, {
        decision,
        reason: reasons[id]?.trim() || undefined,
      }),
    success: ({ decision }) =>
      decision === 'accept'
        ? 'Accepted — the facility still has to confirm you'
        : 'Declined, and your reason goes to the platform without your name',
  });

  const open = (queue.data ?? []).filter((row) => row.status === 'INVITED');
  const answered = (queue.data ?? []).filter((row) => row.status !== 'INVITED');

  return (
    <>
      <PageHeader
        title="Offers"
        description="Accepting is not the same as being confirmed — the facility confirms, and only then is the shift yours. Nothing is committed until they do."
      />

      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>Your offers could not be loaded.</AlertDescription>
        </Alert>
      ) : open.length === 0 && answered.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No offers yet"
          description="A facility offers you a shift and it appears here, with a deadline to answer by."
        />
      ) : (
        <div className="space-y-4">
          {open.map((row) => {
            const lapsed = new Date(row.expiresAt) < new Date();
            const reason = reasons[row.id]?.trim() ?? '';

            return (
              <Card key={row.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div className="min-w-0">
                    <p className="font-medium">Shift {shortId(row.serviceRequestId)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      offered {formatAgo(row.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Answer by" className="sm:col-span-2">
                      {formatWhen(row.expiresAt)}
                    </Detail>
                  </DetailGrid>

                  {lapsed ? (
                    <Alert variant="warning">
                      <TriangleAlert />
                      <AlertDescription>
                        This offer has lapsed. The sweep will withdraw it shortly.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label htmlFor={`reason-${row.id}`}>
                          If you are declining, why?{' '}
                          <span className="font-normal text-muted-foreground">
                            — required, and it reaches the platform without your name
                          </span>
                        </Label>
                        <Textarea
                          id={`reason-${row.id}`}
                          rows={2}
                          placeholder="Rate too low, notice too short, too far to travel…"
                          value={reasons[row.id] ?? ''}
                          onChange={(event) =>
                            setReasons((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          loading={
                            respond.isPending &&
                            respond.variables?.id === row.id &&
                            respond.variables.decision === 'accept'
                          }
                          onClick={() => respond.mutate({ id: row.id, decision: 'accept' })}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="outline"
                          disabled={!reason || respond.isPending}
                          onClick={() => respond.mutate({ id: row.id, decision: 'decline' })}
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

          {answered.length > 0 ? (
            <>
              <h2 className="pt-2 text-sm font-medium text-muted-foreground">Already answered</h2>
              {answered.map((row) => (
                <Card key={row.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                    <div className="min-w-0">
                      <p className="text-sm">Shift {shortId(row.serviceRequestId)}</p>
                      {row.declineReason ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          &ldquo;{row.declineReason}&rdquo;
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge status={row.status} />
                  </CardContent>
                </Card>
              ))}
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
