'use client';

import { useState } from 'react';
import { ShieldAlert, Stethoscope, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { SeverityBadge, StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatWhen, shortId } from '@/components/app/format';

interface Incident {
  id: string;
  facilityId: string;
  assignmentId: string | null;
  subjectUserId: string | null;
  severity: string;
  category: string;
  summary: string;
  status: string;
  occurredAt: string;
  reportedAt: string;
}

/**
 * The order is the argument.
 *
 * `SYSTEM_ISSUE` is first here as it is first in the enum: it is the
 * commonest true answer to a clinical incident and the one a blame-first
 * process never reaches. Suspension is near the bottom because it should be
 * the unusual answer, not the one the cursor lands on.
 */
const OUTCOMES = [
  ['SYSTEM_ISSUE', 'System issue — the cause was the process, not a person'],
  ['NO_ACTION', 'No action'],
  ['ADVICE_GIVEN', 'Advice given'],
  ['TRAINING_REQUIRED', 'Training required'],
  ['PRACTITIONER_SUSPENDED', 'Suspend the practitioner'],
  ['REFERRED_TO_REGULATOR', 'Refer to the regulator'],
] as const;

const MIN_NOTE = 20;

export default function IncidentsPage() {
  const queueKey = ['incidents'];
  const queue = useQueue<Incident>(queueKey, '/api/v1/incidents/queue', (body) => (body as { incidents?: Incident[] }).incidents ?? []);

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Record<string, string>>({});

  const take = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) => api.post(`/api/v1/incidents/${id}/review`),
    success: 'Case taken',
  });

  const close = useQueueAction<{ id: string }>({
    queueKey,
    run: ({ id }) =>
      api.post(`/api/v1/incidents/${id}/close`, {
        outcome: outcome[id] ?? 'SYSTEM_ISSUE',
        notes: notes[id]?.trim(),
      }),
    success: 'Incident closed',
  });

  return (
    <>
      <PageHeader
        title="Clinical incidents"
        description="Most serious first. A report is not an accusation — most of these end as a system issue, which is the answer a blame-first process never reaches."
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
          icon={<Stethoscope />}
          title="Nothing open"
          description="Every reported incident has been closed with an outcome and a reason."
        />
      ) : (
        <div className="space-y-4">
          {queue.data.map((row) => {
            const note = notes[row.id]?.trim() ?? '';
            const chosen = outcome[row.id] ?? 'SYSTEM_ISSUE';
            const mustReview = ['SEVERE', 'DEATH'].includes(row.severity);
            const unopened = row.status === 'REPORTED';
            const blockedByReview = mustReview && unopened;

            return (
              <Card key={row.id}>
                <CardHeader className="space-y-3 pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={row.severity} />
                    <StatusBadge status={row.status} />
                    <span className="text-xs text-muted-foreground">
                      {humanise(row.category)} · reported {formatAgo(row.reportedAt)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed">{row.summary}</p>
                </CardHeader>

                <CardContent className="space-y-4">
                  <DetailGrid>
                    <Detail label="Occurred">{formatWhen(row.occurredAt)}</Detail>
                    <Detail label="Facility">{shortId(row.facilityId)}</Detail>
                    <Detail label="Shift">
                      {row.assignmentId ? shortId(row.assignmentId) : 'Not tied to one'}
                    </Detail>
                    <Detail label="Practitioner named">
                      {row.subjectUserId ? shortId(row.subjectUserId) : 'Nobody'}
                    </Detail>
                  </DetailGrid>

                  <Separator />

                  {blockedByReview ? (
                    <Alert variant="warning">
                      <ShieldAlert />
                      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                        <span>
                          A {row.severity.toLowerCase().replace('_', ' ')} incident cannot be closed
                          until somebody has opened it and looked.
                        </span>
                        <Button
                          size="sm"
                          loading={take.isPending && take.variables?.id === row.id}
                          onClick={() => take.mutate({ id: row.id })}
                        >
                          Take this case
                        </Button>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <Label>Outcome</Label>
                        <Select
                          value={chosen}
                          onValueChange={(value) =>
                            setOutcome((current) => ({ ...current, [row.id]: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {OUTCOMES.map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`notes-${row.id}`}>
                          What was found{' '}
                          <span className="font-normal text-muted-foreground">— required</span>
                        </Label>
                        <Textarea
                          id={`notes-${row.id}`}
                          rows={3}
                          placeholder="The cause, and what follows from it."
                          value={notes[row.id] ?? ''}
                          onChange={(event) =>
                            setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                        />
                        {note.length > 0 && note.length < MIN_NOTE ? (
                          <p className="text-xs text-muted-foreground">
                            {MIN_NOTE - note.length} more characters needed.
                          </p>
                        ) : null}
                      </div>

                      {chosen === 'PRACTITIONER_SUSPENDED' ? (
                        <Alert variant="destructive">
                          <ShieldAlert />
                          <AlertDescription>
                            This suspends the practitioner in the same write as the closure. They
                            stop matching everywhere immediately and their current session stops
                            working on the next request.
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        {unopened ? (
                          <Button
                            variant="outline"
                            loading={take.isPending && take.variables?.id === row.id}
                            onClick={() => take.mutate({ id: row.id })}
                          >
                            Take this case
                          </Button>
                        ) : null}
                        <Button
                          variant={chosen === 'PRACTITIONER_SUSPENDED' ? 'destructive' : 'default'}
                          disabled={note.length < MIN_NOTE || close.isPending}
                          loading={close.isPending && close.variables?.id === row.id}
                          onClick={() => close.mutate({ id: row.id })}
                        >
                          Close incident
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
