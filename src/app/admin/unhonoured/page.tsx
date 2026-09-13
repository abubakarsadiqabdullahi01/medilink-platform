'use client';

import { useState } from 'react';
import { CircleCheck, FileClock, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
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

interface Unhonoured {
  id: string;
  assignmentId: string;
  userId: string;
  facilityId: string;
  status: string;
  fault: string | null;
  shiftEndedAt: string;
  detectedAt: string;
}

/**
 * The three answers, each with what it costs.
 *
 * Only one of them marks somebody's record, and an officer clicking through a
 * queue should not have to hold that in their head. Writing the consequence
 * next to the option is the difference between a considered finding and a
 * fast one.
 */
const FAULTS = [
  {
    value: 'PRACTITIONER',
    label: 'The practitioner',
    consequence:
      'Records a no-show. This is the only option that touches their reliability score.',
    tone: 'destructive' as const,
  },
  {
    value: 'FACILITY',
    label: 'The facility',
    consequence:
      'The ward was shut, nobody was told, the shift never really existed. Costs the practitioner nothing.',
    tone: 'default' as const,
  },
  {
    value: 'NEITHER',
    label: 'Neither',
    consequence:
      'A flood, a bereavement, something nobody could have prevented. A real finding, not a way of avoiding the question.',
    tone: 'default' as const,
  },
];

const MIN_REASON = 10;

export default function UnhonouredPage() {
  const queueKey = ['unhonoured'];
  const queue = useQueue<Unhonoured>(queueKey, '/api/v1/unhonoured', (body) => (body as { unhonoured?: Unhonoured[] }).unhonoured ?? []);

  const [fault, setFault] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});

  const decide = useQueueAction<{ assignmentId: string }>({
    queueKey,
    run: ({ assignmentId }) =>
      api.post(`/api/v1/assignments/${assignmentId}/fault`, {
        fault: fault[assignmentId],
        reason: reason[assignmentId]?.trim(),
      }),
    success: 'Fault recorded',
  });

  return (
    <>
      <PageHeader
        title="Unhonoured shifts"
        description="A shift that ended with no sign of anybody attending. An absence has a dozen innocent explanations and the platform cannot tell them apart — so nothing here closes until a person says whose fault it was."
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
          icon={<FileClock />}
          title="Nothing awaiting a decision"
          description="The hourly sweep flags any confirmed shift that ends with no attendance recorded."
        />
      ) : (
        <div className="space-y-4">
          {queue.data.map((row) => {
            const chosen = fault[row.assignmentId];
            const note = reason[row.assignmentId]?.trim() ?? '';
            const ready = Boolean(chosen) && note.length >= MIN_REASON;

            return (
              <Card key={row.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                  <div>
                    <p className="font-medium">Shift {shortId(row.assignmentId)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Flagged {formatAgo(row.detectedAt)}
                    </p>
                  </div>
                  <StatusBadge status={row.status} />
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Practitioner">{shortId(row.userId)}</Detail>
                    <Detail label="Facility">{shortId(row.facilityId)}</Detail>
                    <Detail label="Shift ended" className="sm:col-span-2">
                      {formatWhen(row.shiftEndedAt)}
                    </Detail>
                  </DetailGrid>

                  <Separator />

                  <fieldset className="space-y-2">
                    <legend className="mb-2 text-sm font-medium">Whose fault was it?</legend>
                    {FAULTS.map((option) => {
                      const selected = chosen === option.value;
                      return (
                        <label
                          key={option.value}
                          className={cn(
                            'flex cursor-pointer gap-3 rounded-md border p-3 transition-colors',
                            selected
                              ? option.tone === 'destructive'
                                ? 'border-destructive/50 bg-destructive/5'
                                : 'border-primary/50 bg-accent'
                              : 'hover:bg-muted/50',
                          )}
                        >
                          <input
                            type="radio"
                            name={`fault-${row.id}`}
                            className="mt-1 accent-current"
                            checked={selected}
                            onChange={() =>
                              setFault((current) => ({
                                ...current,
                                [row.assignmentId]: option.value,
                              }))
                            }
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{option.label}</span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                              {option.consequence}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>

                  <div className="space-y-2">
                    <Label htmlFor={`reason-${row.id}`}>
                      What you found{' '}
                      <span className="font-normal text-muted-foreground">— required</span>
                    </Label>
                    <Textarea
                      id={`reason-${row.id}`}
                      rows={2}
                      placeholder="Who you spoke to and what they said."
                      value={reason[row.assignmentId] ?? ''}
                      onChange={(event) =>
                        setReason((current) => ({
                          ...current,
                          [row.assignmentId]: event.target.value,
                        }))
                      }
                    />
                  </div>

                  <Button
                    disabled={!ready || decide.isPending}
                    loading={decide.isPending && decide.variables?.assignmentId === row.assignmentId}
                    variant={chosen === 'PRACTITIONER' ? 'destructive' : 'default'}
                    onClick={() => decide.mutate({ assignmentId: row.assignmentId })}
                  >
                    <CircleCheck />
                    Record the decision
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
