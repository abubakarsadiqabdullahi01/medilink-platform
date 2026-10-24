'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Gavel, History, Paperclip, } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, PageHeader, ErrorState } from '@/components/app/page-shell';
import { DocumentDialog } from '@/components/app/document-dialog';
import { actionLabel, formatAgo, formatWhen } from '@/components/app/format';
import {
  DECISION_REASONS,
  DECISION_REASON_WORDS,
  type DecisionReasonValue,
} from '@/modules/disputes/domain/dispute';

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
  decisionReason: DecisionReasonValue | null;
  resolutionNotes: string | null;
  resolvedAt: string | null;
  withdrawnAt: string | null;
  /** By when the other side is asked to reply; a marker, it locks nothing. */
  respondBy: string;
  responseNote: string | null;
  respondedAt: string | null;
  /** Where it stands for whoever decides it. */
  stage: 'waiting_for_response' | 'ready_to_decide' | 'under_review' | 'closed';
  responseOverdue: boolean;
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
    reasonLabel: 'Reason to uphold',
    variant: 'success' as const,
    consequence: 'Agrees with whoever raised it. The timesheet reopens so the figures can be put right.',
  },
  {
    value: 'DISMISSED' as const,
    label: 'Dismiss',
    reasonLabel: 'Reason to dismiss',
    variant: 'destructive' as const,
    consequence: 'The shift stands as recorded. Nothing about the payment changes.',
  },
];

export function DisputeDetail({ dispute, onBack }: { dispute: Dispute; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  // One reason per outcome, so a reason can only ever be sent with the outcome it belongs to.
  const [reasons, setReasons] = useState<Partial<Record<'UPHELD' | 'DISMISSED', DecisionReasonValue>>>({});
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
        decisionReason: reasons[outcome],
        notes: note.trim(),
      }),
    onSuccess: (_result, outcome) => {
      toast.success(outcome === 'UPHELD' ? 'Upheld' : 'Dismissed');
      settled();
      onBack();
    },
    onError: (error) => toast.error('Could not record it', { description: errorMessage(error) }),
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
                <DetailGrid>
                  <Detail label="Practitioner">{dispute.practitionerName}</Detail>
                  <Detail label="Facility">{dispute.facilityName}</Detail>
                  <Detail label="Shift">{formatWhen(dispute.shiftStartsAt)}</Detail>
                  <Detail label="Opened">{formatWhen(dispute.createdAt)}</Detail>
                </DetailGrid>

                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    In their words
                  </p>
                  <p className="mt-1 leading-relaxed">{dispute.reason}</p>
                </div>
              </CardContent>
            </Card>

            {/* The other side's one reply, or how long they have. The date is a marker: it
                locks nothing, and the officer may decide before or after it. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  The {dispute.raisedParty === 'PRACTITIONER' ? 'facility' : 'practitioner'}’s reply
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3" data-testid="dispute-reply">
                {dispute.respondedAt && dispute.responseNote ? (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Written {formatWhen(dispute.respondedAt)}
                      {new Date(dispute.respondedAt) > new Date(dispute.respondBy)
                        ? ', after the reply-by date'
                        : ''}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap leading-relaxed">{dispute.responseNote}</p>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      {open
                        ? `No reply yet. They are asked to reply by ${formatWhen(dispute.respondBy)}.`
                        : 'They did not reply.'}
                    </span>
                    {open && dispute.responseOverdue ? <Badge variant="warning">Past the date</Badge> : null}
                  </div>
                )}
              </CardContent>
            </Card>

            {status === 'RESOLVED' ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">How it was decided</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <DetailGrid>
                    <Detail label="Outcome">
                      {dispute.outcome ? humanise(dispute.outcome) : '—'}
                    </Detail>
                    <Detail label="Decided">
                      {dispute.resolvedAt ? formatWhen(dispute.resolvedAt) : '—'}
                    </Detail>
                    <Detail label="It turned on">
                      {dispute.decisionReason
                        ? DECISION_REASON_WORDS[dispute.decisionReason]
                        : 'Not recorded — decided before reasons were kept.'}
                    </Detail>
                  </DetailGrid>
                  {dispute.resolutionNotes ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        What was found
                      </p>
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
                        Nobody has picked this up yet. Marking it under review tells the other side
                        somebody is looking.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        loading={review.isPending}
                        onClick={() => review.mutate()}
                      >
                        Start reviewing
                      </Button>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label htmlFor="dispute-note">
                      Your finding{' '}
                      <span className="font-normal text-muted-foreground">
                        — required, and both sides read it
                      </span>
                    </Label>
                    <Textarea
                      id="dispute-note"
                      rows={4}
                      placeholder="What the evidence showed, and why it decides the case."
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    {note.trim().length > 0 && note.trim().length < MIN_NOTE ? (
                      <p className="text-xs text-muted-foreground">
                        A little more — {MIN_NOTE - note.trim().length} characters to go.
                      </p>
                    ) : null}
                  </div>

                  {status === 'OPEN' && dispute.stage === 'waiting_for_response' && !dispute.respondedAt ? (
                    <Alert variant="info">
                      <Gavel />
                      <AlertDescription>
                        The other side is asked to reply by {formatWhen(dispute.respondBy)} and has not
                        yet. You can decide now, but they will not have been heard.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="space-y-2">
                    {OUTCOMES.map((option) => {
                      const reason = reasons[option.value];
                      return (
                        <div
                          key={option.value}
                          className="space-y-3 rounded-lg border p-3"
                        >
                          <p className="text-sm text-muted-foreground">{option.consequence}</p>
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[220px] flex-1 space-y-1.5">
                              <Label htmlFor={`reason-${option.value}`}>{option.reasonLabel}</Label>
                              <Select
                                value={reason ?? ''}
                                onValueChange={(value) =>
                                  setReasons((current) => ({
                                    ...current,
                                    [option.value]: value as DecisionReasonValue,
                                  }))
                                }
                              >
                                <SelectTrigger id={`reason-${option.value}`}>
                                  <SelectValue placeholder="What it turned on" />
                                </SelectTrigger>
                                <SelectContent>
                                  {DECISION_REASONS[option.value].map((value) => (
                                    <SelectItem key={value} value={value}>
                                      {DECISION_REASON_WORDS[value]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              variant={option.variant}
                              size="sm"
                              disabled={
                                note.trim().length < MIN_NOTE || !reason || resolve.isPending
                              }
                              loading={resolve.isPending && resolve.variables === option.value}
                              onClick={() => resolve.mutate(option.value)}
                            >
                              {option.label}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
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
                  <Skeleton className="h-32 w-full" />
                ) : evidence.isError ? (
        <ErrorState message="The evidence could not be loaded." onRetry={() => void evidence.refetch()} retrying={evidence.isFetching} />
      ) : evidence.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
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
                            <span className="break-words text-sm font-medium">
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
                  <Skeleton className="h-32 w-full" />
                ) : history.isError ? (
        <ErrorState message="The history could not be loaded." onRetry={() => void history.refetch()} retrying={history.isFetching} />
      ) : history.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
                ) : (
                  <ol className="space-y-3">
                    {history.data.map((entry) => (
                      <li key={entry.id} className="border-l-2 border-border pl-4">
                        <p className="text-sm font-medium">
                          {actionLabel(entry.action)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatWhen(entry.createdAt)} · {formatAgo(entry.createdAt)}
                        </p>
                        {entry.reason ? <p className="mt-1 text-sm">{entry.reason}</p> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
