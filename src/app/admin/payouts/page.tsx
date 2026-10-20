'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Banknote, HandCoins, Search, Send, TriangleAlert } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { AmountFigure } from '@/components/app/amount-figure';
import { PayoutAccountPanel, type AccountState } from '@/components/app/payout-account-panel';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton, ErrorState } from '@/components/app/page-shell';
import { useStepUp } from '@/components/app/step-up';
import { formatDate, formatNaira, formatWhen } from '@/components/app/format';
import { lagosDate } from '@/lib/lagos-date';

interface PractitionerHit {
  userId: string;
  fullName: string;
  phone: string;
}

interface Payout {
  id: string;
  practitionerId: string;
  amountKobo: number;
  status: string;
  providerReference: string | null;
  failureReason: string | null;
  releasedAt: string | null;
  settledAt: string | null;
  /** The date a transfer made by hand left the bank. */
  paidOn: string | null;
  createdAt: string;
  /** Whether the person looking prepared it, which decides whether they may release it. */
  preparedByYou: boolean;
}

/**
 * Paying practitioners.
 *
 * Prepare and release are two acts, and the page keeps them apart: preparing
 * proposes clearing a balance the ledger already shows, releasing is the
 * moment money is supposed to move. That gap is where an authorise-then-
 * capture provider goes when one exists, and until then it is where a person
 * checks the figure.
 *
 * Finding somebody used to mean already knowing their uuid, typed into a
 * plain text box — the one piece of information nobody doing this job
 * actually starts with. It searches by name now, the same directory
 * `/admin/practitioners` reads from.
 */
export default function PayoutsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [selected, setSelected] = useState<PractitionerHit | null>(null);

  // Paying by hand: finance make the transfer at the bank, then say here which one it
  // was. Either that or a reason it did not happen is what closes a released payout.
  const [recording, setRecording] = useState<Payout | null>(null);
  const [transfer, setTransfer] = useState({ reference: '', paidOn: '' });
  const [withdrawing, setWithdrawing] = useState<{ payout: Payout; kind: 'fail' | 'cancel' } | null>(null);
  const [reason, setReason] = useState('');

  const results = useQuery({
    queryKey: ['practitioner-search-for-payouts', applied],
    queryFn: () =>
      api.get<{ practitioners?: PractitionerHit[] }>(
        `/api/v1/practitioners?limit=8&search=${encodeURIComponent(applied)}`,
      ),
    enabled: Boolean(applied),
  });

  const payouts = useQuery({
    queryKey: ['payouts', selected?.userId],
    queryFn: () =>
      api.get<{
        payouts: Payout[];
        owedKobo: number;
        heldKobo: number;
        payableKobo: number;
        awaitingKobo: number;
        account: { state: AccountState; readyAt: string | null };
        secondApproverRequired: boolean;
        paidByHand: boolean;
      }>(
        `/api/v1/payouts?scopeType=PLATFORM&scopeId=${selected!.userId}`,
      ),
    enabled: Boolean(selected),
  });

  // Accounts practitioners have given that nobody has checked yet: the other half of
  // what finance have to do before anybody can be paid.
  const waiting = useQuery({
    queryKey: ['payout-accounts', 'queue'],
    queryFn: () =>
      api.get<{
        accounts: {
          id: string;
          practitionerId: string;
          practitionerName: string;
          bankName: string;
          last4: string;
          createdAt: string;
          problems: string[];
        }[];
      }>('/api/v1/payout-accounts'),
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['payouts'] });
  }

  const stepUp = useStepUp('Preparing and releasing a payout moves money.');

  const prepare = useMutation({
    mutationFn: () => api.post('/api/v1/payouts', { practitionerId: selected!.userId }),
    onSuccess: () => {
      toast.success('Prepared', { description: 'Nothing has moved yet. Release it to pay.' });
      refresh();
    },
    onError: (error) => {
      if (stepUp.handle(error, () => prepare.mutate())) return;
      toast.error('Could not prepare it', { description: errorMessage(error) });
    },
  });

  const byHand = payouts.data?.paidByHand === true;

  const release = useMutation({
    mutationFn: (payout: Payout) => api.post(`/api/v1/payouts/${payout.id}/release`),
    onSuccess: () => {
      if (byHand) {
        toast.success('Released to finance', {
          description: 'Make the bank transfer, then record it here to complete the payout.',
        });
      } else {
        toast.success('Released to the gateway');
      }
      refresh();
    },
    onError: (error, payout) => {
      if (stepUp.handle(error, () => release.mutate(payout))) return;
      toast.error(byHand ? 'Could not release it' : 'The gateway refused it', {
        description: errorMessage(error),
      });
    },
  });

  const settle = useMutation({
    mutationFn: (payout: Payout) =>
      api.post(`/api/v1/payouts/${payout.id}/settle`, {
        bankReference: transfer.reference.trim(),
        paidOn: transfer.paidOn,
      }),
    onSuccess: () => {
      toast.success('Recorded as paid', {
        description: 'The ledger now shows it paid, and the practitioner has been told.',
      });
      setRecording(null);
      refresh();
    },
    onError: (error, payout) => {
      if (stepUp.handle(error, () => settle.mutate(payout))) return;
      toast.error('Could not record it', { description: errorMessage(error) });
    },
  });

  const withdraw = useMutation({
    mutationFn: ({ payout, kind }: { payout: Payout; kind: 'fail' | 'cancel' }) =>
      api.post(`/api/v1/payouts/${payout.id}/${kind}`, { reason: reason.trim() }),
    onSuccess: (_data, { kind }) => {
      toast.success(kind === 'cancel' ? 'Cancelled' : 'Recorded as not paid', {
        description: 'What it was holding can be prepared again.',
      });
      setWithdrawing(null);
      setReason('');
      refresh();
    },
    onError: (error, variables) => {
      if (stepUp.handle(error, () => withdraw.mutate(variables))) return;
      toast.error('Could not do that', { description: errorMessage(error) });
    },
  });

  function startRecording(payout: Payout) {
    setRecording(payout);
    // Today in Lagos, which is when somebody is recording a transfer they have just made.
    setTransfer({ reference: '', paidOn: lagosDate(new Date()) });
  }

  if (!selected) {
    const hits = results.data?.practitioners ?? [];

    return (
      <>
        <PageHeader
          title="Payouts"
          description="What the ledger says a practitioner is owed, and clearing it. Preparing moves nothing; releasing is the act that does."
        />

        <Alert variant="info" className="mb-6">
          <AlertDescription>
            A practitioner is paid only from money a facility has actually paid, however much
            they are owed. Where payouts are made by bank transfer, releasing one hands it to
            finance; the transfer is made at the bank and recorded here, and recording it is what
            completes the payout.
          </AlertDescription>
        </Alert>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Find a practitioner</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setApplied(search.trim());
              }}
            >
              <div className="min-w-[240px] flex-1 space-y-1.5">
                <Label htmlFor="practitioner-search">Search by name or number</Label>
                <Input
                  id="practitioner-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Amina, or 0803 123 4567"
                />
              </div>
              <Button type="submit" loading={results.isFetching}>
                <Search />
                Search
              </Button>
            </form>
          </CardContent>
        </Card>

        {(waiting.data?.accounts.length ?? 0) > 0 ? (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Accounts waiting to be checked</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {waiting.data!.accounts.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelected({ userId: row.practitionerId, fullName: row.practitionerName, phone: '' })}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
                >
                  <span>
                    <span className="font-medium">{row.practitionerName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {row.bankName} · <span className="font-mono">••••••{row.last4}</span> · given {formatDate(row.createdAt)}
                    </span>
                  </span>
                  {row.problems.length > 0 ? (
                    <span className="text-xs text-warning">Needs a look: {row.problems.length === 1 ? '1 thing' : `${row.problems.length} things`} to resolve</span>
                  ) : null}
                </button>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {!applied ? (
          <EmptyState
            icon={<HandCoins />}
            title="Nobody chosen yet"
            description="Payouts are per person, and the ledger is what decides the amount."
          />
        ) : results.isPending ? (
          <QueueSkeleton rows={2} />
        ) : results.isError ? (
        <ErrorState message="The directory could not be searched." onRetry={() => void results.refetch()} retrying={results.isFetching} />
      ) : hits.length === 0 ? (
          <EmptyState
            icon={<HandCoins />}
            title="Nobody matches that"
            description="Try part of a name, or the number they registered with."
          />
        ) : (
          <div className="space-y-2">
            {hits.map((hit) => (
              <button
                key={hit.userId}
                type="button"
                onClick={() => setSelected(hit)}
                className="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                <p className="font-medium">{hit.fullName}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{hit.phone}</p>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {stepUp.dialog}
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => setSelected(null)}>
        <ArrowLeft />
        Find somebody else
      </Button>

      <PageHeader title={selected.fullName} description={selected.phone} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <AmountFigure
          label="Owed"
          amountKobo={payouts.data?.owedKobo ?? 0}
          hint="Approved and invoiced, not yet paid out."
          isPending={payouts.isPending}
          isError={payouts.isError}
        />
        <AmountFigure
          label="Can be paid now"
          amountKobo={payouts.data?.payableKobo ?? 0}
          hint="Collected from facilities, and not held or already in flight."
          isPending={payouts.isPending}
          isError={payouts.isError}
          emphasise
        />
        <AmountFigure
          label="Waiting on facilities"
          amountKobo={payouts.data?.awaitingKobo ?? 0}
          hint="On invoices that have not been paid yet."
          isPending={payouts.isPending}
          isError={payouts.isError}
        />
      </div>

      {payouts.data ? (
        <PayoutAccountPanel
          practitionerId={selected.userId}
          standing={payouts.data.account.state}
          readyAt={payouts.data.account.readyAt}
        />
      ) : null}

      <Dialog open={recording !== null} onOpenChange={(open) => (open ? null : setRecording(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record the transfer of {recording ? formatNaira(recording.amountKobo) : ''}</DialogTitle>
            <DialogDescription>
              Make the transfer from the bank first, then enter what the statement shows. This is
              what completes the payout, and the practitioner is told once it is recorded.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="transfer-reference">Bank reference for the transfer</Label>
              <Input
                id="transfer-reference"
                value={transfer.reference}
                maxLength={100}
                onChange={(event) => setTransfer({ ...transfer, reference: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-date">Date it left the bank</Label>
              <Input
                id="transfer-date"
                type="date"
                value={transfer.paidOn}
                onChange={(event) => setTransfer({ ...transfer, paidOn: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecording(null)}>
              Cancel
            </Button>
            <Button
              variant="success"
              disabled={transfer.reference.trim().length < 3 || transfer.paidOn === ''}
              loading={settle.isPending}
              onClick={() => recording && settle.mutate(recording)}
            >
              <Banknote />
              Record transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={withdrawing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setWithdrawing(null);
            setReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {withdrawing?.kind === 'cancel' ? 'Cancel this payout' : 'The transfer did not go through'}
            </DialogTitle>
            <DialogDescription>
              {withdrawing?.kind === 'cancel'
                ? 'Nothing has been released, so nothing has moved. What it was holding can be prepared again.'
                : 'Use this only if the money did not leave the bank. If it did, record the transfer instead, or the practitioner will be paid twice.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="payout-reason">
              {withdrawing?.kind === 'cancel' ? 'Why is it being cancelled?' : 'What happened?'}
            </Label>
            <Textarea
              id="payout-reason"
              value={reason}
              maxLength={500}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawing(null)}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length === 0}
              loading={withdraw.isPending}
              onClick={() => withdrawing && withdraw.mutate(withdrawing)}
            >
              {withdrawing?.kind === 'cancel' ? 'Cancel payout' : 'Record as not paid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Prepare a payout</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            For what has been collected, less anything already in flight and anything held for a
            dispute.
          </p>
          {payouts.data && payouts.data.awaitingKobo > 0 ? (
            <Alert variant="info" className="mb-3">
              <AlertDescription>
                <strong>{formatNaira(payouts.data.awaitingKobo)}</strong> of the{' '}
                {formatNaira(payouts.data.owedKobo)} owed is on invoices a facility has not paid
                yet. It can be paid out once the payment is recorded as received.
              </AlertDescription>
            </Alert>
          ) : null}
          {payouts.data && payouts.data.heldKobo > 0 ? (
            <Alert variant="warning" className="mb-3">
              <TriangleAlert />
              <AlertDescription>
                <strong>{formatNaira(payouts.data.heldKobo)}</strong> of the{' '}
                {formatNaira(payouts.data.owedKobo)} owed is on a shift that is in dispute. It is
                not paid until the case is decided or withdrawn; the rest can be.
              </AlertDescription>
            </Alert>
          ) : null}
          <Button
            loading={prepare.isPending}
            disabled={
              payouts.data !== undefined &&
              (payouts.data.payableKobo <= 0 ||
                ['missing', 'unverified', 'cooling_off'].includes(payouts.data.account.state))
            }
            onClick={() => prepare.mutate()}
          >
            <HandCoins />
            {payouts.data && payouts.data.payableKobo > 0
              ? `Prepare ${formatNaira(payouts.data.payableKobo)}`
              : 'Prepare'}
          </Button>
        </CardContent>
      </Card>

      {payouts.isPending ? (
        <QueueSkeleton rows={2} />
      ) : payouts.isError ? (
        <ErrorState message="Their payouts could not be loaded." onRetry={() => void payouts.refetch()} retrying={payouts.isFetching} />
      ) : payouts.data.payouts.length === 0 ? (
        <EmptyState icon={<HandCoins />} title="No payouts for this practitioner" />
      ) : (
        <div className="space-y-4">
          {payouts.data.payouts.map((payout) => (
            <Card key={payout.id}>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
                <p className="tabular text-lg font-semibold">{formatNaira(payout.amountKobo)}</p>
                <StatusBadge status={payout.status} />
              </CardHeader>

              <CardContent className="space-y-4">
                <DetailGrid>
                  <Detail label="Prepared">{formatWhen(payout.createdAt)}</Detail>
                  <Detail label="Released">{formatWhen(payout.releasedAt)}</Detail>
                  <Detail label="Settled">{formatWhen(payout.settledAt)}</Detail>
                  {payout.paidOn ? <Detail label="Left the bank">{formatDate(payout.paidOn)}</Detail> : null}
                  <Detail label="Reference">
                    <span className="font-mono text-xs">{payout.providerReference ?? '—'}</span>
                  </Detail>
                </DetailGrid>

                {payout.failureReason ? (
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertDescription>
                      {payout.failureReason}
                      {/* Said explicitly, because "failed" alone invites a
                          second attempt that would double-pay if it were
                          wrong about what happened. */}
                      <span className="mt-1 block text-xs">
                        Nothing moved and the ledger was not touched.
                      </span>
                    </AlertDescription>
                  </Alert>
                ) : null}

                {payout.status === 'PREPARED' ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={payouts.data.secondApproverRequired && payout.preparedByYou}
                        loading={release.isPending && release.variables?.id === payout.id}
                        onClick={() => release.mutate(payout)}
                      >
                        <Send />
                        Release {formatNaira(payout.amountKobo)}
                      </Button>
                      <Button variant="outline" onClick={() => setWithdrawing({ payout, kind: 'cancel' })}>
                        Cancel it
                      </Button>
                    </div>
                    {payouts.data.secondApproverRequired && payout.preparedByYou ? (
                      <p className="text-xs text-muted-foreground">
                        You prepared this one, so a colleague who can manage payouts has to release
                        it. Two people, not one, between a balance and the bank.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {payout.status === 'RELEASED' ? (
                  payouts.data.paidByHand ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Released to finance. Make the transfer of {formatNaira(payout.amountKobo)} at
                        the bank, then record it here.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="success" onClick={() => startRecording(payout)}>
                          <Banknote />
                          Record the transfer
                        </Button>
                        <Button variant="outline" onClick={() => setWithdrawing({ payout, kind: 'fail' })}>
                          It did not go through
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sent to the payment gateway. It completes when the gateway confirms.
                    </p>
                  )
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
