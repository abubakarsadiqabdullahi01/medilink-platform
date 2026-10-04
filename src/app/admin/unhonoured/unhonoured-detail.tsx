'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CircleCheck, History, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, PageHeader } from '@/components/app/page-shell';
import { formatAgo, formatWhen } from '@/components/app/format';

/**
 * One unhonoured shift, and the decision about whose fault it was.
 *
 * The three options are not a dropdown, and each states its consequence, for
 * the reason the original queue gave: only one of them marks a practitioner's
 * record, and an officer clicking through a morning should not have to hold
 * that in their head. What changed is that the decision now happens on its own
 * screen with the shift in front of it, instead of inside a card in a list.
 */

export interface Unhonoured {
  id: string;
  assignmentId: string;
  userId: string;
  facilityId: string;
  practitionerName: string;
  practitionerPhone: string;
  facilityName: string;
  status: string;
  fault: string | null;
  reason: string | null;
  decidedAt: string | null;
  shiftStartsAt: string;
  shiftEndedAt: string;
  detectedAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
}

const FAULTS = [
  {
    value: 'PRACTITIONER',
    label: 'The practitioner',
    consequence: 'Records a no-show. This is the only option that touches their reliability score.',
  },
  {
    value: 'FACILITY',
    label: 'The facility',
    consequence:
      'The ward was shut, nobody was told, the shift never really existed. Costs the practitioner nothing.',
  },
  {
    value: 'NEITHER',
    label: 'Neither',
    consequence:
      'A flood, a bereavement, something nobody could have prevented. A real finding, not a way of avoiding the question.',
  },
];

const MIN_REASON = 10;

export function UnhonouredDetail({ record, onBack }: { record: Unhonoured; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [fault, setFault] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const history = useQuery({
    queryKey: ['unhonoured-history', record.id],
    queryFn: async () => {
      const body = await api.get<{ entries?: AuditEntry[] }>(
        `/api/v1/audit?scopeType=PLATFORM&entityId=${record.id}&limit=25`,
      );
      return body.entries ?? [];
    },
    retry: false,
  });

  const open = record.status === 'AWAITING_DECISION';

  const decide = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/assignments/${record.assignmentId}/fault`, {
        fault,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Fault recorded');
      void queryClient.invalidateQueries({ queryKey: ['unhonoured-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['unhonoured-history', record.id] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
      onBack();
    },
    onError: (error) => toast.error('Could not record it', { description: errorMessage(error) }),
  });

  return (
    <>
      <PageHeader
        title={record.practitionerName}
        description={`${record.facilityName} · shift ended ${formatAgo(record.shiftEndedAt)}`}
        action={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft />
            All unhonoured shifts
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div className="min-w-0">
              <p className="font-medium">{record.practitionerName}</p>
              <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                {record.practitionerPhone}
              </p>
            </div>
            <StatusBadge status={record.status} />
          </CardContent>
        </Card>

        <Tabs defaultValue="shift">
          <TabsList>
            <TabsTrigger value="shift">The shift</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="shift" className="space-y-6 pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What the sweep found</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <DetailGrid>
                  <Detail label="Facility">{record.facilityName}</Detail>
                  <Detail label="Shift started">{formatWhen(record.shiftStartsAt)}</Detail>
                  <Detail label="Shift ended">{formatWhen(record.shiftEndedAt)}</Detail>
                  <Detail label="Flagged">{formatAgo(record.detectedAt)}</Detail>
                </DetailGrid>

                <p className="text-xs leading-relaxed text-muted-foreground">
                  The shift ended with no check-in and no check-out recorded against it. That is all
                  the platform knows — it cannot tell an absence from a failed network or a ward
                  that closed, which is why nothing here closes without a person.
                </p>
              </CardContent>
            </Card>

            {record.status === 'CLOSED' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">What was decided</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <DetailGrid>
                    <Detail label="Fault">{record.fault ? humanise(record.fault) : '—'}</Detail>
                    <Detail label="Decided">
                      {record.decidedAt ? formatWhen(record.decidedAt) : '—'}
                    </Detail>
                  </DetailGrid>
                  {record.reason ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        What was found
                      </p>
                      <p className="mt-1">{record.reason}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {open ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Whose fault was it?</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    {FAULTS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFault(option.value)}
                        className={cn(
                          'flex w-full gap-3 rounded-lg border p-4 text-left transition-colors',
                          fault === option.value
                            ? 'border-primary bg-accent/50'
                            : 'hover:border-primary/40',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                            fault === option.value ? 'border-primary bg-primary' : 'border-input',
                          )}
                          aria-hidden="true"
                        >
                          {fault === option.value ? (
                            <CircleCheck className="size-3 text-primary-foreground" />
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium">{option.label}</span>
                          <span className="mt-0.5 block text-sm text-muted-foreground">
                            {option.consequence}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="fault-reason">
                      What you found{' '}
                      <span className="font-normal text-muted-foreground">— required</span>
                    </Label>
                    <Textarea
                      id="fault-reason"
                      rows={3}
                      placeholder="Who you spoke to and what they said."
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>

                  <Button
                    disabled={!fault || reason.trim().length < MIN_REASON || decide.isPending}
                    loading={decide.isPending}
                    onClick={() => decide.mutate()}
                  >
                    Record the decision
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="history" className="pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <History className="size-4 text-muted-foreground" aria-hidden="true" />
                  What has happened to this flag
                </CardTitle>
              </CardHeader>
              <CardContent>
                {history.isPending ? (
                  <Skeleton className="h-32 w-full" />
                ) : history.isError ? (
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertDescription>The history could not be loaded.</AlertDescription>
                  </Alert>
                ) : history.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
                ) : (
                  <ol className="space-y-3">
                    {history.data.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-border pl-4">
                        <p className="text-sm font-medium">
                          {humanise(entry.action.replace(/\./g, ' '))}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatWhen(entry.createdAt)} · {formatAgo(entry.createdAt)}
                        </p>
                        {entry.reason ? <p className="mt-1 text-sm">{entry.reason}</p> : null}
                      </li>
                    ))}
                  </ol>
                )}

                {/* The sweep has no actor, and a name against a finding nobody
                    made would read as somebody having decided it. */}
                <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                  The flag itself was raised by the nightly sweep, which is not a person and so
                  carries no name.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
