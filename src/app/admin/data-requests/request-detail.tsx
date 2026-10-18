'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, History, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { Detail, DetailGrid, PageHeader } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { useStepUp } from '@/components/app/step-up';
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
      void queryClient.invalidateQueries({ queryKey: ['request-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['request-history', request.id] });
      onBack();
    },
    onError: (error) => toast.error('Could not record that', { description: errorMessage(error) }),
  });

  const erase = useMutation({
    mutationFn: () => api.post<{ files: { deleted: number; pending: number } }>(`/api/v1/data-requests/${request.id}/erase`),
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
      toast.error('Could not erase', { description: errorMessage(error) });
    },
  });

  const isErasure = request.kind === 'ERASURE';

  return (
    <>
      {stepUp.dialog}
      <Dialog
        open={erasing}
        onOpenChange={(next) => {
          if (!next) {
            setErasing(false);
            setConfirmation('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase {request.subjectName}</DialogTitle>
            <DialogDescription>
              This cannot be undone. Their name, email and number are replaced, their sign-ins
              ended, what they wrote or was sent to them deleted, their files deleted from storage
              and the account closed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="font-medium">What is kept, and why</p>
            <ul className="space-y-2 text-xs text-muted-foreground">
              {ERASURE_RETAINED.map((row) => (
                <li key={row.area}>
                  <span className="font-medium text-foreground">{row.area}.</span> {row.reason}
                </li>
              ))}
            </ul>
            <div className="space-y-1.5 pt-2">
              <Label htmlFor="erase-confirmation">Type ERASE to confirm</Label>
              <Input
                id="erase-confirmation"
                value={confirmation}
                autoComplete="off"
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErasing(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmation.trim() !== 'ERASE'}
              loading={erase.isPending}
              onClick={() => erase.mutate()}
            >
              Erase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive-text">
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
                <DetailGrid>
                  <Detail label="Right">{humanise(request.kind)}</Detail>
                  <Detail label="Received">{formatWhen(request.receivedAt)}</Detail>
                  <Detail label="Due by">{formatWhen(request.dueBy)}</Detail>
                  <Detail label="Answered">
                    {request.completedAt ? formatWhen(request.completedAt) : 'Not yet'}
                  </Detail>
                </DetailGrid>

                {request.detail ? (
                  <div className="rounded-md bg-muted px-3 py-2 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      In their words
                    </p>
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
                  <DetailGrid>
                    <Detail label="Outcome">{humanise(request.status)}</Detail>
                    <Detail label="Closed">
                      {request.completedAt ? formatWhen(request.completedAt) : '—'}
                    </Detail>
                  </DetailGrid>
                  {request.outcome ? (
                    <div className="rounded-md bg-muted px-3 py-2 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        What was done
                      </p>
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
                        Nobody has picked this up yet. Marking it in progress says you have it —
                        the month still runs from the day it arrived.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
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

                  <div className="space-y-1.5">
                    <Label htmlFor="request-outcome">
                      What was done{' '}
                      <span className="font-normal text-muted-foreground">
                        — required either way, and the subject reads it
                      </span>
                    </Label>
                    <Textarea
                      id="request-outcome"
                      rows={4}
                      placeholder="What you did, or why you are refusing."
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {isErasure ? (
                      <Button
                        variant="destructive"
                        disabled={request.status !== 'IN_PROGRESS'}
                        onClick={() => setErasing(true)}
                      >
                        Erase this person
                      </Button>
                    ) : (
                      <Button
                        variant="success"
                        disabled={outcome.trim().length < MIN_OUTCOME || close.isPending}
                        loading={close.isPending && close.variables === 'COMPLETED'}
                        onClick={() => close.mutate('COMPLETED')}
                      >
                        Answered
                      </Button>
                    )}
                    <Button
                      variant={isErasure ? 'outline' : 'destructive'}
                      disabled={outcome.trim().length < MIN_OUTCOME || close.isPending}
                      loading={close.isPending && close.variables === 'REFUSED'}
                      onClick={() => close.mutate('REFUSED')}
                    >
                      Refuse
                    </Button>
                  </div>
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
                  <Skeleton className="h-32 w-full" />
                ) : history.isError ? (
                  <ErrorState
                    error={history.error}
                    onRetry={() => void history.refetch()}
                    retrying={history.isFetching}
                    compact
                  />
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
