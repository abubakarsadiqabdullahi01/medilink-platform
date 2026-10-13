'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileText, ShieldCheck } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, humanise } from '@/components/app/status-badge';
import { formatWhen } from '@/components/app/format';

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
 */
export function PrivacySection() {
  const queryClient = useQueryClient();
  const [withdrawing, setWithdrawing] = useState<Consent | null>(null);
  const [note, setNote] = useState('');
  const [reading, setReading] = useState<Agreement | null>(null);

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
    },
    onError: (error) => toast.error('Could not raise it', { description: errorMessage(error) }),
  });

  /** Downloads what the API returns, rather than showing it and hoping. */
  async function download() {
    try {
      const data = await api.get<unknown>('/api/v1/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `medilink-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success('Downloaded');
    } catch (error) {
      toast.error('Could not build the export', { description: errorMessage(error) });
    }
  }

  return (
    <>
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
              ) : (
                (consent.data?.consent ?? []).map((row) => (
                  <div
                    key={row.purpose}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">
                          {PURPOSE_LABELS[row.purpose] ?? humanise(row.purpose)}
                        </p>
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
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {PURPOSE_DETAIL[row.purpose]}
                      </p>
                      {row.note ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          You said: &ldquo;{row.note}&rdquo;
                        </p>
                      ) : null}
                    </div>

                    {row.withdrawable ? (
                      row.granted ? (
                        <Button
                          variant="outline"
                          size="sm"
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
                          loading={
                            setConsent.isPending && setConsent.variables?.purpose === row.purpose
                          }
                          onClick={() => setConsent.mutate({ purpose: row.purpose, granted: true })}
                        >
                          Turn on
                        </Button>
                      )
                    ) : null}
                  </div>
                ))
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
              ) : (agreements.data?.agreements ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing published yet.</p>
              ) : (
                (agreements.data?.agreements ?? []).map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{row.title}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {row.identifier}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {row.acceptedAt ? (
                        <Badge variant="success">Accepted {formatWhen(row.acceptedAt)}</Badge>
                      ) : (
                        <Badge variant="warning">Not yet accepted</Badge>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setReading(row)}>
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
              <Button onClick={download}>
                <Download />
                Download my data
              </Button>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                The audit trail and the financial ledger are not in it. Both mention you and neither
                is about you — an audit row is the platform&apos;s record of its own conduct, and a
                ledger entry has somebody else on the other side of it.
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
              ) : (
                <>
                  <Alert variant={erasure.data?.canProceed ? 'info' : 'warning'}>
                    <ShieldCheck />
                    <AlertDescription>{erasure.data?.whatErasureDoes}</AlertDescription>
                  </Alert>

                  {(erasure.data?.blockers ?? []).length > 0 ? (
                    <div className="space-y-2">
                      {erasure.data!.blockers.map((blocker) => (
                        <p key={blocker.code} className="text-xs text-muted-foreground">
                          · {blocker.explanation}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  <Button
                    variant="outline"
                    loading={raise.isPending && raise.variables === 'ERASURE'}
                    onClick={() => raise.mutate('ERASURE')}
                  >
                    Ask anyway
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {(requests.data?.requests ?? []).length > 0 ? (
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
                      <span className="text-xs text-muted-foreground">
                        asked {formatWhen(row.receivedAt)} · due {formatWhen(row.dueBy)}
                      </span>
                    </div>
                    {row.outcome ? <p className="mt-2 text-sm">{row.outcome}</p> : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Dialog
        open={withdrawing !== null}
        onOpenChange={(next: boolean) => !next && setWithdrawing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Withdraw: {withdrawing ? PURPOSE_LABELS[withdrawing.purpose] : ''}
            </DialogTitle>
            <DialogDescription>
              {withdrawing?.purpose === 'CREDENTIAL_SHARING'
                ? 'Facilities will no longer see that your credentials are verified, which means you will stop being offered shifts. You can turn it back on at any time.'
                : 'You can turn this back on at any time.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="note">Why</Label>
            <Textarea
              id="note"
              rows={2}
              placeholder="In your own words."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawing(null)}>
              Keep it on
            </Button>
            <Button
              variant="destructive"
              disabled={!note.trim()}
              loading={setConsent.isPending}
              onClick={() =>
                withdrawing &&
                setConsent.mutate({
                  purpose: withdrawing.purpose,
                  granted: false,
                  note: note.trim(),
                })
              }
            >
              Withdraw it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reading !== null} onOpenChange={(next: boolean) => !next && setReading(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{reading?.title}</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {reading?.identifier} · in force from {formatWhen(reading?.effectiveFrom)}
            </DialogDescription>
          </DialogHeader>

          <Separator />
          <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
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
