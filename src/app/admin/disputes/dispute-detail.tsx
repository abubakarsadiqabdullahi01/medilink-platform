'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Gavel, History, Paperclip } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-shell';
import { DocumentDialog } from '@/components/app/document-dialog';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { Timeline } from '@/components/app/timeline';
import { actionLabel, formatAgo, formatWhen } from '@/components/app/format';

/**
 * One dispute, adjudicated with the evidence in front of you.
 *
 * The queue used to resolve a case from an expanded card in the list, which
 * worked and left out the one thing an adjudicator most needs: **the evidence
 * was not on the screen at all.** Both parties can attach photographs, rotas
 * and letters, the API has served them since Stage 8, and nothing in the
 * console ever asked for them — so cases were being decided on the written
 * reason alone while the attachments sat in object storage.
 *
 * The two outcomes do different things to the shift and the buttons still say
 * so, because an adjudicator working at speed should not have to remember
 * which of "uphold" and "dismiss" reopens the figures.
 */

export interface Dispute {
  id: string;
  assignmentId: string;
  userId: string;
  facilityId: string;
  practitionerName: string;
  facilityName: string;
  shiftStartsAt: string;
  raisedParty: string;
  category: string;
  reason: string;
  status: string;
  outcome: string | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
}

interface Evidence {
  id: string;
  objectKey: string;
  attachedByName: string;
  attachedBySide: 'PRACTITIONER' | 'FACILITY';
  note: string | null;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
}

const MIN_NOTE = 20;

const OUTCOMES = [
  {
    value: 'UPHELD' as const,
    label: 'Uphold',
    variant: 'success' as const,
    consequence:
      'Agrees with whoever raised it. The timesheet goes back to the facility to be decided again, so the figures can be put right.',
  },
  {
    value: 'DISMISSED' as const,
    label: 'Dismiss',
    variant: 'destructive' as const,
    consequence: 'The shift stands as recorded. Nothing about the payment changes.',
  },
];

/** A fact with its label, wrapping rather than cutting a name short. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function DisputeDetail({ dispute, onBack }: { dispute: Dispute; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState<'UPHELD' | 'DISMISSED' | null>(null);
  /**
   * The status as this screen last changed it.
   *
   * `dispute` is the row the queue was showing when it was opened, and does
   * not move. Starting a review used to send the officer back to the queue to
   * pick the case up again — from a tab it was no longer on, because it had
   * just stopped being open.
   */
  const [status, setStatus] = useState(dispute.status);

  const open = status === 'OPEN' || status === 'UNDER_REVIEW';

  const evidence = useQuery({
    queryKey: ['dispute-evidence', dispute.id],
    queryFn: async () => {
      const body = await api.get<{ evidence?: Evidence[] }>(
        `/api/v1/disputes/${dispute.id}/evidence`,
      );
      return body.evidence ?? [];
    },
    retry: false,
  });

  const history = useQuery({
    queryKey: ['dispute-history', dispute.id],
    queryFn: async () => {
      const body = await api.get<{ entries?: AuditEntry[] }>(
        `/api/v1/audit?scopeType=PLATFORM&entityId=${dispute.id}&limit=25`,
      );
      return body.entries ?? [];
    },
    retry: false,
  });

  const settled = () => {
    void queryClient.invalidateQueries({ queryKey: ['disputes'] });
    void queryClient.invalidateQueries({ queryKey: ['dispute-history', dispute.id] });
    void queryClient.invalidateQueries({ queryKey: ['tile'] });
  };

  const review = useMutation({
    mutationFn: () => api.post(`/api/v1/disputes/${dispute.id}/review`, { id: dispute.id }),
    onSuccess: () => {
      toast.success('Marked as under review');
      setStatus('UNDER_REVIEW');
      settled();
    },
    onError: (error) => toast.error('Could not start it', { description: errorMessage(error) }),
  });

  const resolve = useMutation({
    mutationFn: (outcome: 'UPHELD' | 'DISMISSED') =>
      api.post(`/api/v1/disputes/${dispute.id}/resolve`, {
        id: dispute.id,
        outcome,
        notes: note.trim(),
      }),
    onSuccess: (_result, outcome) => {
      toast.success(outcome === 'UPHELD' ? 'Upheld' : 'Dismissed');
      setDeciding(null);
      settled();
      onBack();
    },
  });

  return (
    <>
      <PageHeader
        title={`${humanise(dispute.category)} — ${dispute.practitionerName}`}
        description={`${dispute.facilityName} · opened ${formatAgo(dispute.createdAt)}`}
        action={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft />
            All disputes
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={dispute.raisedParty === 'PRACTITIONER' ? 'info' : 'warning'}>
                Raised by the {dispute.raisedParty.toLowerCase()}
              </Badge>
              <Badge variant="secondary">{humanise(dispute.category)}</Badge>
            </div>
            <StatusBadge status={status} />
          </CardContent>
        </Card>

        <Tabs defaultValue="case">
          <TabsList>
            <TabsTrigger value="case">The case</TabsTrigger>
            <TabsTrigger value="evidence">
              Evidence
              {evidence.data && evidence.data.length > 0 ? (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs">
                  {evidence.data.length}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="case" className="space-y-6 pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What is being disputed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Fact label="Practitioner">{dispute.practitionerName}</Fact>
                  <Fact label="Facility">{dispute.facilityName}</Fact>
                  <Fact label="Shift">{formatWhen(dispute.shiftStartsAt)}</Fact>
                  <Fact label="Opened">{formatWhen(dispute.createdAt)}</Fact>
                </dl>

                <div className="rounded-md bg-muted px-3 py-2">
                  <p className="text-sm font-medium text-muted-foreground">In their words</p>
                  <p className="mt-1 leading-relaxed">{dispute.reason}</p>
                </div>
              </CardContent>
            </Card>

            {status === 'RESOLVED' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">How it was decided</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Fact label="Outcome">{dispute.outcome ? humanise(dispute.outcome) : '—'}</Fact>
                    <Fact label="Decided">
                      {dispute.resolvedAt ? formatWhen(dispute.resolvedAt) : '—'}
                    </Fact>
                  </dl>
                  {dispute.resolutionNotes ? (
                    <div className="rounded-md bg-muted px-3 py-2">
                      <p className="text-sm font-medium text-muted-foreground">What was found</p>
                      <p className="mt-1">{dispute.resolutionNotes}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : status === 'WITHDRAWN' ? (
              <Alert variant="info">
                <Gavel />
                <AlertDescription>
                  Withdrawn by whoever raised it
                  {dispute.withdrawnAt ? `, ${formatAgo(dispute.withdrawnAt)}` : ''}. Nothing about
                  the shift changed.
                </AlertDescription>
              </Alert>
            ) : null}

            {open ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Decide it</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {status === 'OPEN' ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                        Nobody has picked this up yet. Marking it under review tells both sides
                        somebody is looking; they are sent the shift, not what was argued.
                      </p>
                      <Button
                        variant="outline"
                        loading={review.isPending}
                        onClick={() => review.mutate()}
                      >
                        Start reviewing
                      </Button>
                    </div>
                  ) : null}

                  <Field
                    label="Your finding"
                    required
                    hint={`Both sides read it. At least ${MIN_NOTE} characters.`}
                    error={
                      note.trim().length > 0 && note.trim().length < MIN_NOTE
                        ? `A little more — ${MIN_NOTE - note.trim().length} characters to go.`
                        : undefined
                    }
                  >
                    <Textarea
                      rows={4}
                      placeholder="What the evidence showed, and why it decides the case."
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </Field>

                  <div className="space-y-2">
                    {OUTCOMES.map((option) => (
                      <div
                        key={option.value}
                        className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
                      >
                        <span className="min-w-0 flex-1 text-base text-muted-foreground">
                          {option.consequence}
                        </span>
                        <Button
                          variant={option.variant}
                          disabled={note.trim().length < MIN_NOTE}
                          onClick={() => setDeciding(option.value)}
                        >
                          {option.label}…
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="evidence" className="pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Paperclip className="size-4 text-muted-foreground" aria-hidden="true" />
                  What each side attached
                </CardTitle>
              </CardHeader>
              <CardContent>
                {evidence.isPending ? (
                  <ListSkeleton rows={2} label="Loading the evidence" />
                ) : evidence.isError ? (
                  <ErrorState
                    error={evidence.error}
                    onRetry={() => void evidence.refetch()}
                    retrying={evidence.isFetching}
                    compact
                  />
                ) : evidence.data.length === 0 ? (
                  <p className="text-base text-muted-foreground">
                    Neither side has attached anything. The case has to be decided on the written
                    reason alone — say so in your finding.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {evidence.data.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                          <FileText className="size-4" aria-hidden="true" />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Which side produced it, because the same
                                photograph means different things depending. */}
                            <Badge
                              variant={item.attachedBySide === 'PRACTITIONER' ? 'info' : 'warning'}
                            >
                              {item.attachedBySide === 'PRACTITIONER'
                                ? 'The practitioner'
                                : 'The facility'}
                            </Badge>
                            <span className="truncate text-sm font-medium">
                              {item.attachedByName}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatWhen(item.createdAt)}
                          </p>
                          {item.note ? <p className="mt-1 text-sm">{item.note}</p> : null}
                        </div>

                        <DocumentDialog
                          title={`Evidence from ${item.attachedByName}`}
                          description={
                            item.attachedBySide === 'PRACTITIONER'
                              ? 'Attached by the practitioner.'
                              : 'Attached by the facility.'
                          }
                          fetchUrl={() =>
                            api.post<{ url: string }>(
                              `/api/v1/disputes/${dispute.id}/evidence/${item.id}/url`,
                              { id: dispute.id, evidenceId: item.id },
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {/* Reading a piece of evidence is itself recorded. Better the
                    person doing it knows than discovers later. */}
                <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                  Opening an attachment is recorded against the case. Evidence cannot be removed by
                  either side once attached.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <History className="size-4 text-muted-foreground" aria-hidden="true" />
                  What has happened to this case
                </CardTitle>
              </CardHeader>
              <CardContent>
                {history.isPending ? (
                  <ListSkeleton rows={2} label="Loading the history" />
                ) : history.isError ? (
                  <ErrorState
                    error={history.error}
                    onRetry={() => void history.refetch()}
                    retrying={history.isFetching}
                    compact
                  />
                ) : history.data.length === 0 ? (
                  <p className="text-base text-muted-foreground">Nothing recorded yet.</p>
                ) : (
                  <Timeline
                    label="History of this dispute"
                    steps={history.data.map((entry) => ({
                      id: entry.id,
                      state: 'done' as const,
                      title: actionLabel(entry.action),
                      when: `${formatWhen(entry.createdAt)} · ${formatAgo(entry.createdAt)}`,
                      detail: entry.reason ?? undefined,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={deciding !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeciding(null);
            resolve.reset();
          }
        }}
        title={deciding === 'UPHELD' ? 'Uphold this dispute' : 'Dismiss this dispute'}
        object={
          <>
            {dispute.practitionerName} · {dispute.facilityName}
            <span className="block font-normal text-muted-foreground">
              Shift {formatWhen(dispute.shiftStartsAt)} · raised by the{' '}
              {dispute.raisedParty.toLowerCase()}
            </span>
          </>
        }
        consequence={
          deciding === 'UPHELD' ? (
            <>
              You agree with the {dispute.raisedParty.toLowerCase()}. The timesheet goes back to the
              facility to be decided again, and the facility corrects it through the ordinary route,
              with its own revision and reason. Nothing is rewritten for them. Both sides are told
              the outcome and can read your finding.
            </>
          ) : (
            <>
              The shift stands as recorded: the timesheet returns to the state it was in before the
              dispute was opened, and nothing about the payment changes. Both sides are told the
              outcome and can read your finding.
            </>
          )
        }
        reversible={false}
        confirmLabel={deciding === 'UPHELD' ? 'Uphold dispute' : 'Dismiss dispute'}
        cancelLabel="Not yet"
        loading={resolve.isPending}
        error={resolve.error ? errorMessage(resolve.error) : null}
        onConfirm={() => deciding && resolve.mutate(deciding)}
      >
        <figure className="rounded-md border bg-muted/40 px-3 py-2">
          <figcaption className="text-sm font-medium text-muted-foreground">
            Your finding, as both sides will read it
          </figcaption>
          <blockquote className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
            {note.trim()}
          </blockquote>
        </figure>
      </ConfirmDialog>
    </>
  );
}
