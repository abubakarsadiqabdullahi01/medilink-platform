'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleAlert, Download, FileText, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Field } from '@/components/app/field';
import { ErrorState } from '@/components/app/states';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { formatWhen } from '@/components/app/format';
import { useDownloadMyData } from '@/components/app/download-my-data';

interface Consent {
  purpose: string;
  granted: boolean;
  lawfulBasis: string;
  withdrawable: boolean;
  grantedAt: string;
  withdrawnAt: string | null;
  note: string | null;
}

interface Agreement {
  id: string;
  kind: string;
  identifier: string;
  title: string;
  body: string;
  effectiveFrom: string;
  acceptedAt: string | null;
}

interface Erasure {
  canProceed: boolean;
  blockers: { code: string; explanation: string }[];
  whatErasureDoes: string;
}

interface SubjectRequest {
  id: string;
  kind: string;
  status: string;
  outcome: string | null;
  receivedAt: string;
  dueBy: string;
  overdue: boolean;
}

const PURPOSE_LABELS: Record<string, string> = {
  IDENTITY_VERIFICATION: 'Verifying who you are',
  CREDENTIAL_SHARING: 'Showing your credentials to a facility',
  PROFILE_VISIBILITY: 'Letting facilities find your profile',
  MARKETING: 'Hearing from Medilink about other things',
};

const PURPOSE_DETAIL: Record<string, string> = {
  IDENTITY_VERIFICATION:
    'Checking your NIN and your practising licence. Required by regulation before you can treat patients, so this one is not yours to switch off.',
  CREDENTIAL_SHARING:
    'A hospital considering you for a shift sees that your credentials are verified. Turn this off and you will not be offered work.',
  PROFILE_VISIBILITY: 'Your profile appears when a facility searches for cover.',
  MARKETING: 'Entirely optional, and turning it off changes nothing about getting work.',
};

/**
 * What the platform holds, what it was allowed to do, and how to change it.
 *
 * A right that exists only in a privacy notice is not a right, so each one
 * here is a control rather than a paragraph: the export downloads, the
 * withdrawal writes a record, and the erasure check answers before you ask.
 *
 * A panel that could not be loaded says so and offers a retry. It never draws as an empty list:
 * "Nothing published yet" over a failed request tells somebody there is nothing to agree to,
 * and an erasure panel with no answer in it must not offer the button at all.
 */
export function PrivacySection() {
  const queryClient = useQueryClient();
  const [withdrawing, setWithdrawing] = useState<Consent | null>(null);
  const [note, setNote] = useState('');
  const [reading, setReading] = useState<Agreement | null>(null);
  const [erasing, setErasing] = useState(false);

  const consent = useQuery({
    queryKey: ['consent'],
    queryFn: () => api.get<{ consent: Consent[] }>('/api/v1/consent'),
  });

  const agreements = useQuery({
    queryKey: ['agreements'],
    queryFn: () => api.get<{ agreements: Agreement[] }>('/api/v1/agreements'),
  });

  const erasure = useQuery({
    queryKey: ['erasure'],
    queryFn: () => api.get<Erasure>('/api/v1/me/erasure'),
  });

  const requests = useQuery({
    queryKey: ['my-data-requests'],
    queryFn: () => api.get<{ requests: SubjectRequest[] }>('/api/v1/me/data-requests'),
  });

  const setConsent = useMutation({
    mutationFn: (input: { purpose: string; granted: boolean; note?: string }) =>
      api.post('/api/v1/consent', input),
    onSuccess: (_data, input) => {
      toast.success(input.granted ? 'Turned on' : 'Withdrawn, with your reason on the record');
      void queryClient.invalidateQueries({ queryKey: ['consent'] });
      setWithdrawing(null);
      setNote('');
    },
    onError: (error) => toast.error('Could not change it', { description: errorMessage(error) }),
  });

  const accept = useMutation({
    mutationFn: (versionId: string) => api.post('/api/v1/agreements', { versionId }),
    onSuccess: () => {
      toast.success('Accepted');
      void queryClient.invalidateQueries({ queryKey: ['agreements'] });
      setReading(null);
    },
    onError: (error) => toast.error('Could not accept it', { description: errorMessage(error) }),
  });

  const raise = useMutation({
    mutationFn: (kind: string) => api.post('/api/v1/data-requests', { kind }),
    onSuccess: () => {
      toast.success('Request raised', { description: 'Compliance has a month to answer it.' });
      void queryClient.invalidateQueries({ queryKey: ['my-data-requests'] });
      setErasing(false);
    },
    onError: (error) => toast.error('Could not raise it', { description: errorMessage(error) }),
  });

  const myData = useDownloadMyData();

  // A request already open is not asked for twice. If the list could not be read this is false,
  // and the button stays: the server decides, not a guess.
  const erasureOpen = (requests.data?.requests ?? []).some(
    (row) => row.kind === 'ERASURE' && (row.status === 'RECEIVED' || row.status === 'IN_PROGRESS'),
  );
  const blockers = erasure.data?.blockers ?? [];

  return (
    <>
      {myData.dialog}
      {/* What you have agreed to on the left; the things you can ask for on the
          right. Stacked on a phone, in the same order. */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What you have agreed to</CardTitle>
              <CardDescription>
                Not everything here is consent. Some of it the platform does because a regulator
                requires it — those say so, and cannot be switched off.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {consent.isPending ? (
                <Skeleton className="h-32 w-full" />
              ) : consent.isError ? (
                <ErrorState
                  error={consent.error}
                  onRetry={() => void consent.refetch()}
                  retrying={consent.isFetching}
                  compact
                />
              ) : (
                (consent.data?.consent ?? []).map((row) => {
                  const label = PURPOSE_LABELS[row.purpose] ?? humanise(row.purpose);
                  return (
                    <div
                      key={row.purpose}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{label}</p>
                          {/* Something done under a legal obligation is neither on
                          nor off — "Off" beside identity checks read as though
                          nobody verified anyone. */}
                          {row.withdrawable ? (
                            <Badge variant={row.granted ? 'success' : 'secondary'}>
                              {row.granted ? 'On' : 'Off'}
                            </Badge>
                          ) : null}
                          {!row.withdrawable ? (
                            <Badge variant="outline">
                              {row.lawfulBasis === 'LEGAL_OBLIGATION'
                                ? 'Required by law'
                                : humanise(row.lawfulBasis)}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {PURPOSE_DETAIL[row.purpose]}
                        </p>
                        {row.note ? (
                          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                            You said: &ldquo;{row.note}&rdquo;
                          </p>
                        ) : null}
                      </div>

                      {row.withdrawable ? (
                        row.granted ? (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Withdraw: ${label}`}
                            onClick={() => {
                              setWithdrawing(row);
                              setNote('');
                            }}
                          >
                            Withdraw
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            aria-label={`Turn on: ${label}`}
                            loading={
                              setConsent.isPending && setConsent.variables?.purpose === row.purpose
                            }
                            onClick={() =>
                              setConsent.mutate({ purpose: row.purpose, granted: true })
                            }
                          >
                            Turn on
                          </Button>
                        )
                      ) : null}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agreements</CardTitle>
              <CardDescription>
                The version you accepted is recorded, not the file — so what you agreed to stays
                readable even after the terms change.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {agreements.isPending ? (
                <Skeleton className="h-20 w-full" />
              ) : agreements.isError ? (
                <ErrorState
                  error={agreements.error}
                  onRetry={() => void agreements.refetch()}
                  retrying={agreements.isFetching}
                  compact
                />
              ) : (agreements.data?.agreements ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing published yet.</p>
              ) : (
                (agreements.data?.agreements ?? []).map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{row.title}</p>
                      <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                        {row.identifier}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {row.acceptedAt ? (
                        <Badge variant="success">Accepted {formatWhen(row.acceptedAt)}</Badge>
                      ) : (
                        <Badge variant="warning">Not yet accepted</Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Read ${row.title}`}
                        onClick={() => setReading(row)}
                      >
                        <FileText />
                        Read
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Get a copy</CardTitle>
              <CardDescription>
                Everything held about you, as a file you can keep or take elsewhere.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => void myData.download()}>
                <Download />
                Download my data
              </Button>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                It asks for your password again, because it holds everything at once. The audit
                trail and the financial ledger are not in it — an audit row is the platform&apos;s
                record of its own conduct, and a ledger entry has somebody else on the other side of
                it. What else is left out, and why, is written at the top of the file.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ask to be erased</CardTitle>
              <CardDescription>What that would and would not do.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {erasure.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : erasure.isError ? (
                <ErrorState
                  error={erasure.error}
                  onRetry={() => void erasure.refetch()}
                  retrying={erasure.isFetching}
                  compact
                />
              ) : (
                <>
                  <Alert variant={erasure.data?.canProceed ? 'info' : 'warning'}>
                    <ShieldCheck />
                    <AlertDescription>{erasure.data?.whatErasureDoes}</AlertDescription>
                  </Alert>

                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Asking sends a request to Medilink&rsquo;s compliance team, who have a month to
                    answer it. Nothing is deleted when you ask. If it is carried out, your account
                    is closed and you can no longer sign in.
                  </p>

                  {blockers.length > 0 ? (
                    <div className="space-y-2 rounded-md border border-warning/40 p-3">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <CircleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                        Not possible yet. These have to be settled first:
                      </p>
                      <ul className="list-disc space-y-1 pl-9 text-sm text-muted-foreground">
                        {blockers.map((blocker) => (
                          <li key={blocker.code}>{blocker.explanation}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {erasureOpen ? (
                    <p className="text-sm font-medium">
                      You have already asked. It is listed under &ldquo;What you have asked
                      for&rdquo;.
                    </p>
                  ) : (
                    <Button variant="outline" onClick={() => setErasing(true)}>
                      Ask to be erased
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {requests.isError ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">What you have asked for</CardTitle>
              </CardHeader>
              <CardContent>
                <ErrorState
                  error={requests.error}
                  onRetry={() => void requests.refetch()}
                  retrying={requests.isFetching}
                  compact
                />
              </CardContent>
            </Card>
          ) : (requests.data?.requests ?? []).length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">What you have asked for</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {requests.data!.requests.map((row) => (
                  <div key={row.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{humanise(row.kind)}</Badge>
                      <StatusBadge status={row.status} />
                      {row.overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Asked {formatWhen(row.receivedAt)} · due {formatWhen(row.dueBy)}
                    </p>
                    {row.outcome ? <p className="mt-2">{row.outcome}</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(next) => !next && setWithdrawing(null)}
        title={`Withdraw: ${withdrawing ? (PURPOSE_LABELS[withdrawing.purpose] ?? humanise(withdrawing.purpose)) : ''}`}
        object={
          withdrawing ? (PURPOSE_LABELS[withdrawing.purpose] ?? humanise(withdrawing.purpose)) : ''
        }
        consequence={
          withdrawing?.purpose === 'CREDENTIAL_SHARING'
            ? 'Facilities will no longer see that your credentials are verified, which means you will stop being offered shifts.'
            : 'The platform stops doing this, and your reason is kept on the record.'
        }
        reversible="You can turn it back on at any time."
        destructive
        confirmLabel="Withdraw it"
        cancelLabel="Keep it on"
        loading={setConsent.isPending}
        confirmDisabled={!note.trim()}
        onConfirm={() =>
          withdrawing &&
          setConsent.mutate({
            purpose: withdrawing.purpose,
            granted: false,
            note: note.trim(),
          })
        }
      >
        <Field label="Why" hint="In your own words. Required." required>
          <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={erasing}
        onOpenChange={setErasing}
        title="Ask to be erased"
        object="Erase my Medilink account and personal details"
        consequence="Medilink’s compliance team decides, and has a month to. Nothing is deleted until they carry it out. You cannot withdraw this request from this page."
        reversible={false}
        destructive
        confirmLabel="Ask to be erased"
        cancelLabel="Keep my account"
        loading={raise.isPending}
        onConfirm={() => raise.mutate('ERASURE')}
      >
        <div className="space-y-3 text-sm">
          <div>
            <p className="font-medium">If it is carried out</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Your name, phone number and email are replaced.</li>
              <li>Your professional record and uploaded files are removed.</li>
              <li>You can no longer sign in.</li>
            </ul>
            <p className="mt-2 text-muted-foreground">{erasure.data?.whatErasureDoes}</p>
          </div>
          {blockers.length > 0 ? (
            <div>
              <p className="font-medium">It cannot be carried out yet, because</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                {blockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.explanation}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </ConfirmDialog>

      <Dialog open={reading !== null} onOpenChange={(next: boolean) => !next && setReading(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{reading?.title}</DialogTitle>
            <DialogDescription className="font-mono text-sm">
              {reading?.identifier} · in force from {formatWhen(reading?.effectiveFrom)}
            </DialogDescription>
          </DialogHeader>

          <Separator />
          <div
            className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap leading-relaxed"
            tabIndex={0}
            aria-label={`Text of ${reading?.title ?? 'the agreement'}`}
          >
            {reading?.body}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReading(null)}>
              Close
            </Button>
            {reading && !reading.acceptedAt ? (
              <Button loading={accept.isPending} onClick={() => accept.mutate(reading.id)}>
                I agree
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
