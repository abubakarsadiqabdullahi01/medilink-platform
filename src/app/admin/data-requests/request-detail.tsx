'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, History, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { PageHeader } from '@/components/app/page-shell';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { isStepUpRequired, useStepUp } from '@/components/app/step-up';
import { Timeline } from '@/components/app/timeline';
import { actionLabel, formatAgo, formatWhen } from '@/components/app/format';
import { ERASURE_RETAINED } from '@/modules/audit-compliance/domain/erasure';

/**
 * One data-subject request, answered with the duty in front of you.
 *
 * The Act gives a month and expects a reply that says what was done. A refusal
 * is a lawful outcome and has to be recorded as carefully as a grant — more
 * so, because it is the one somebody appeals. Both buttons therefore demand
 * the same written answer, and the subject reads it either way.
 */

export interface SubjectRequest {
  id: string;
  userId: string;
  subjectName: string;
  subjectPhone: string;
  kind: string;
  status: string;
  detail: string | null;
  outcome: string | null;
  receivedAt: string;
  dueBy: string;
  completedAt: string | null;
  overdue: boolean;
}

interface AuditEntry {
  id: string;
  action: string;
  reason: string | null;
  createdAt: string;
}

/** What each right actually obliges the platform to do. */
const KIND_DUTY: Record<string, string> = {
  ACCESS: 'A copy of everything held about them, in a readable form.',
  PORTABILITY: 'A copy in a form they can take elsewhere. The export endpoint produces it.',
  RECTIFICATION: 'Something held about them is wrong and has to be corrected.',
  ERASURE:
    'Identifying details are replaced. Audit rows and ledger entries are retained under a legal obligation — tell them that, rather than letting them assume otherwise.',
  RESTRICTION: 'They want processing stopped while something is resolved.',
};

const MIN_OUTCOME = 10;

/** A fact with its label, wrapping rather than cutting a name short. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function RequestDetail({
  request,
  onBack,
}: {
  request: SubjectRequest;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState('');
  const [erasing, setErasing] = useState(false);
  const [closing, setClosing] = useState<'COMPLETED' | 'REFUSED' | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const stepUp = useStepUp('Erasing a person cannot be undone.');

  const history = useQuery({
    queryKey: ['request-history', request.id],
    queryFn: async () => {
      const body = await api.get<{ entries?: AuditEntry[] }>(
        `/api/v1/audit?scopeType=PLATFORM&entityId=${request.id}&limit=25`,
      );
      return body.entries ?? [];
    },
    retry: false,
  });

  const open = request.status === 'RECEIVED' || request.status === 'IN_PROGRESS';

  const start = useMutation({
    mutationFn: () => api.post(`/api/v1/data-requests/${request.id}/start`, { id: request.id }),
    onSuccess: () => {
      toast.success('Marked as in progress');
      void queryClient.invalidateQueries({ queryKey: ['request-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['request-history', request.id] });
      onBack();
    },
    onError: (error) => toast.error('Could not pick it up', { description: errorMessage(error) }),
  });

  const close = useMutation({
    mutationFn: (status: 'COMPLETED' | 'REFUSED') =>
      api.post(`/api/v1/data-requests/${request.id}/close`, { status, outcome: outcome.trim() }),
    onSuccess: (_result, status) => {
      toast.success(status === 'COMPLETED' ? 'Answered' : 'Refused, with the reason recorded');
      setClosing(null);
      void queryClient.invalidateQueries({ queryKey: ['request-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['request-history', request.id] });
      onBack();
    },
  });

  const erase = useMutation({
    mutationFn: () =>
      api.post<{ files: { deleted: number; pending: number } }>(
        `/api/v1/data-requests/${request.id}/erase`,
      ),
    onSuccess: (report) => {
      toast.success('Erased', {
        description:
          report.files.pending > 0
            ? `${report.files.pending} file(s) could not be deleted from storage yet. Press Erase again to finish them.`
            : 'Their details are replaced, their files deleted and the account closed.',
      });
      setErasing(false);
      setConfirmation('');
      void queryClient.invalidateQueries({ queryKey: ['request-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['request-history', request.id] });
      onBack();
    },
    onError: (error) => {
      if (stepUp.handle(error, () => erase.mutate())) return;
    },
  });

  const isErasure = request.kind === 'ERASURE';

  return (
    <>
      {stepUp.dialog}
      <ConfirmDialog
        open={erasing}
        onOpenChange={(next) => {
          if (!next) {
            setErasing(false);
            setConfirmation('');
            erase.reset();
          }
        }}
        title={`Erase ${request.subjectName}`}
        object={
          <>
            {request.subjectName}
            <span className="block font-mono text-sm font-normal text-muted-foreground">
              {request.subjectPhone}
            </span>
          </>
        }
        consequence={
          <>
            Their name, email and number are replaced, their sign-ins ended, what they wrote or was
            sent to them deleted, their files deleted from storage and the account closed.
          </>
        }
        reversible={false}
        destructive
        confirmLabel="Erase this person"
        cancelLabel="Do not erase"
        loading={erase.isPending}
        error={erase.error && !isStepUpRequired(erase.error) ? errorMessage(erase.error) : null}
        confirmDisabled={confirmation.trim() !== 'ERASE'}
        onConfirm={() => erase.mutate()}
      >
        <div className="space-y-3">
          <p className="font-medium">What is kept, and why</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {ERASURE_RETAINED.map((row) => (
              <li key={row.area}>
                <span className="font-medium text-foreground">{row.area}.</span> {row.reason}
              </li>
            ))}
          </ul>
          <Field label="Type ERASE to confirm" required>
            <Input
              value={confirmation}
              autoComplete="off"
              autoCapitalize="characters"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(next) => {
          if (!next) {
            setClosing(null);
            close.reset();
          }
        }}
        title={closing === 'COMPLETED' ? 'Record the request as answered' : 'Refuse the request'}
        object={
          <>
            {humanise(request.kind)} · {request.subjectName}
            <span className="block font-normal text-muted-foreground">
              Due {formatWhen(request.dueBy)}
            </span>
          </>
        }
        consequence={
          closing === 'COMPLETED' ? (
            <>
              The request is closed as answered, with what you wrote as the answer. No message is
              sent: they can read it in the app.
            </>
          ) : (
            <>
              The request is closed as refused, with your reason as the answer. A refusal is the
              outcome people appeal, so the reason is what stands. No message is sent: they can read
              it in the app.
            </>
          )
        }
        reversible={false}
        destructive={closing === 'REFUSED'}
        confirmLabel={closing === 'COMPLETED' ? 'Record as answered' : 'Refuse the request'}
        cancelLabel="Not yet"
        loading={close.isPending}
        error={close.error ? errorMessage(close.error) : null}
        onConfirm={() => closing && close.mutate(closing)}
      >
        <figure className="rounded-md border bg-muted/40 px-3 py-2">
          <figcaption className="text-sm font-medium text-muted-foreground">
            What they will read
          </figcaption>
          <blockquote className="mt-1 whitespace-pre-wrap text-base [overflow-wrap:anywhere]">
            {outcome.trim()}
          </blockquote>
        </figure>
      </ConfirmDialog>

      <PageHeader
        title={`${humanise(request.kind)} — ${request.subjectName}`}
        description={`Received ${formatAgo(request.receivedAt)} · due ${formatWhen(request.dueBy)}`}
        action={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft />
            All data requests
          </Button>
        }
      />

      <div className="space-y-6">
        <Card className={request.overdue ? 'border-destructive/40' : undefined}>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div className="min-w-0">
              <p className="font-medium">{request.subjectName}</p>
              <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                {request.subjectPhone}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {request.overdue ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-sm font-medium text-destructive-text">
                  <TriangleAlert className="size-4" aria-hidden="true" />
                  Past its deadline
                </span>
              ) : null}
              <StatusBadge status={request.status} />
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="request">
          <TabsList>
            <TabsTrigger value="request">The request</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="request" className="space-y-6 pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What they asked for</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Fact label="Right">{humanise(request.kind)}</Fact>
                  <Fact label="Received">{formatWhen(request.receivedAt)}</Fact>
                  <Fact label="Due by">{formatWhen(request.dueBy)}</Fact>
                  <Fact label="Answered">
                    {request.completedAt ? formatWhen(request.completedAt) : 'Not yet'}
                  </Fact>
                </dl>

                {request.detail ? (
                  <div className="rounded-md bg-muted px-3 py-2">
                    <p className="text-sm font-medium text-muted-foreground">In their words</p>
                    <p className="mt-1">{request.detail}</p>
                  </div>
                ) : null}

                <Alert variant="info">
                  <ShieldCheck />
                  <AlertDescription>
                    {KIND_DUTY[request.kind] ?? 'A right exercised over their own record.'}
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {!open ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">How it was answered</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Fact label="Outcome">{humanise(request.status)}</Fact>
                    <Fact label="Closed">
                      {request.completedAt ? formatWhen(request.completedAt) : '—'}
                    </Fact>
                  </dl>
                  {request.outcome ? (
                    <div className="rounded-md bg-muted px-3 py-2">
                      <p className="text-sm font-medium text-muted-foreground">What was done</p>
                      <p className="mt-1">{request.outcome}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {open ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Answer it</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {request.status === 'RECEIVED' ? (
                    /* Optional, not a required step. A simple access request
                       answered in one sitting should not need a click first;
                       this is for the ones that take days, so a colleague
                       opening the queue does not start it again. */
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                        Nobody has picked this up yet. Marking it in progress says you have it — the
                        month still runs from the day it arrived.
                      </p>
                      <Button
                        variant="outline"
                        loading={start.isPending}
                        onClick={() => start.mutate()}
                      >
                        I am working on it
                      </Button>
                    </div>
                  ) : null}

                  {isErasure ? (
                    <Alert variant="warning">
                      <TriangleAlert />
                      <AlertDescription>
                        Erase carries it out: it does not just record that it was done. Pick the
                        request up first. It will be refused with the reason if something blocks it
                        (a shift still to work, money owed, an open dispute, or an account that
                        works for a facility). To refuse it yourself, write why below.
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <Field
                    label="What was done"
                    required
                    hint={`Required either way, and the subject reads it. At least ${MIN_OUTCOME} characters.`}
                    error={
                      outcome.trim().length > 0 && outcome.trim().length < MIN_OUTCOME
                        ? `${MIN_OUTCOME - outcome.trim().length} more character${MIN_OUTCOME - outcome.trim().length === 1 ? '' : 's'} needed.`
                        : undefined
                    }
                  >
                    <Textarea
                      rows={4}
                      placeholder="What you did, or why you are refusing."
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value)}
                    />
                  </Field>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    {isErasure ? (
                      <Button
                        variant="destructive"
                        disabled={request.status !== 'IN_PROGRESS'}
                        onClick={() => setErasing(true)}
                      >
                        Erase this person…
                      </Button>
                    ) : (
                      <Button
                        variant="success"
                        disabled={outcome.trim().length < MIN_OUTCOME}
                        onClick={() => setClosing('COMPLETED')}
                      >
                        Answered…
                      </Button>
                    )}
                    <Button
                      variant={isErasure ? 'outline' : 'destructive'}
                      disabled={outcome.trim().length < MIN_OUTCOME}
                      onClick={() => setClosing('REFUSED')}
                    >
                      Refuse…
                    </Button>
                  </div>
                  {isErasure && request.status !== 'IN_PROGRESS' ? (
                    <p className="text-sm text-muted-foreground">
                      Erasing is available once the request is marked in progress.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="history" className="pt-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <History className="size-4 text-muted-foreground" aria-hidden="true" />
                  What has happened to this request
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
                    label="History of this request"
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
    </>
  );
}
