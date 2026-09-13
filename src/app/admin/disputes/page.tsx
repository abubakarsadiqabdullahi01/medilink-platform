'use client';

import { useState } from 'react';
import { Gavel, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, shortId } from '@/components/app/format';

interface Dispute {
  id: string;
  assignmentId: string;
  userId: string;
  facilityId: string;
  raisedParty: string;
  category: string;
  reason: string;
  status: string;
  createdAt: string;
}

const MIN_NOTE = 20;

/**
 * Disputes — module 14.
 *
 * The two outcomes do different things to the shift, and the buttons say so
 * rather than leaving it to be learned. An adjudicator working at speed
 * should not have to remember which of "uphold" and "dismiss" reopens the
 * figures.
 */
export default function DisputesPage() {
  const queueKey = ['disputes'];
  const queue = useQueue<Dispute>(queueKey, '/api/v1/disputes', (body) => (body as { disputes?: Dispute[] }).disputes ?? []);

  const [notes, setNotes] = useState<Record<string, string>>({});

  const take = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) => api.post(`/api/v1/disputes/${id}/review`),
    success: 'Case taken',
  });

  const resolve = useQueueAction<{ id: string; outcome: 'UPHELD' | 'DISMISSED' }>({
    queueKey,
    run: ({ id, outcome }) =>
      api.post(`/api/v1/disputes/${id}/resolve`, { outcome, notes: notes[id]?.trim() }),
    success: ({ outcome }) =>
      outcome === 'UPHELD' ? 'Upheld — the figures go back' : 'Dismissed — the record is restored',
  });

  return (
    <>
      <PageHeader
        title="Disputes"
        description="A shift the two sides disagree about, after it was decided. You decide who was right; the facility then corrects the timesheet through the ordinary route, so the change is visible in the revisions."
      />

      {queue.isPending ? (
        <QueueSkeleton />
      ) : queue.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>This queue could not be loaded.</AlertDescription>
        </Alert>
      ) : queue.data.length === 0 ? (
        <EmptyState
          icon={<Gavel />}
          title="No live cases"
          description="Every dispute has been resolved or withdrawn."
        />
      ) : (
        <div className="space-y-4">
          {queue.data.map((row) => {
            const note = notes[row.id]?.trim() ?? '';
            const ready = note.length >= MIN_NOTE;

            return (
              <Card key={row.id}>
                <CardHeader className="space-y-3 pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={row.raisedParty === 'PRACTITIONER' ? 'info' : 'warning'}>
                      Raised by the {row.raisedParty.toLowerCase()}
                    </Badge>
                    <Badge variant="secondary">{humanise(row.category)}</Badge>
                    <StatusBadge status={row.status} />
                    <span className="text-xs text-muted-foreground">
                      opened {formatAgo(row.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{row.reason}</p>
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Shift">{shortId(row.assignmentId)}</Detail>
                    <Detail label="Practitioner">{shortId(row.userId)}</Detail>
                    <Detail label="Facility">{shortId(row.facilityId)}</Detail>
                  </DetailGrid>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor={`notes-${row.id}`}>
                      Your finding{' '}
                      <span className="font-normal text-muted-foreground">
                        — required, and both sides will read it
                      </span>
                    </Label>
                    <Textarea
                      id={`notes-${row.id}`}
                      rows={3}
                      placeholder="What the evidence showed."
                      value={notes[row.id] ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                    />
                    {note.length > 0 && !ready ? (
                      <p className="text-xs text-muted-foreground">
                        {MIN_NOTE - note.length} more characters needed.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {row.status === 'OPEN' ? (
                      <Button
                        variant="outline"
                        loading={take.isPending && take.variables?.id === row.id}
                        onClick={() => take.mutate({ id: row.id })}
                      >
                        Take this case
                      </Button>
                    ) : null}
                    <Button
                      disabled={!ready || resolve.isPending}
                      loading={
                        resolve.isPending &&
                        resolve.variables?.id === row.id &&
                        resolve.variables?.outcome === 'UPHELD'
                      }
                      onClick={() => resolve.mutate({ id: row.id, outcome: 'UPHELD' })}
                    >
                      Uphold — send the figures back
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!ready || resolve.isPending}
                      loading={
                        resolve.isPending &&
                        resolve.variables?.id === row.id &&
                        resolve.variables?.outcome === 'DISMISSED'
                      }
                      onClick={() => resolve.mutate({ id: row.id, outcome: 'DISMISSED' })}
                    >
                      Dismiss — restore the record
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
