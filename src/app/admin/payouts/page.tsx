'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, HandCoins, Search, Send, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { useStepUp } from '@/components/app/step-up';
import { formatNaira, formatWhen } from '@/components/app/format';

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
  createdAt: string;
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
      api.get<{ payouts: Payout[] }>(
        `/api/v1/payouts?scopeType=PLATFORM&scopeId=${selected!.userId}`,
      ),
    enabled: Boolean(selected),
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

  const release = useMutation({
    mutationFn: (payout: Payout) => api.post(`/api/v1/payouts/${payout.id}/release`),
    onSuccess: () => {
      toast.success('Released to the gateway');
      refresh();
    },
    onError: (error, payout) => {
      if (stepUp.handle(error, () => release.mutate(payout))) return;
      toast.error('The gateway refused it', { description: errorMessage(error) });
    },
  });

  if (!selected) {
    const hits = results.data?.practitioners ?? [];

    return (
      <>
        <PageHeader
          title="Payouts"
          description="What the ledger says a practitioner is owed, and clearing it. Preparing moves nothing; releasing is the act that does."
        />

        <Alert variant="warning" className="mb-6">
          <TriangleAlert />
          <AlertDescription>
            <strong>No payment provider is configured.</strong> Releasing a payout locally writes
            the ledger entry and returns a reference beginning <code>stub-</code>, so nobody
            mistakes it for a bank one. No money moves until the provider decision is taken.
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

        {!applied ? (
          <EmptyState
            icon={<HandCoins />}
            title="Nobody chosen yet"
            description="Payouts are per person, and the ledger is what decides the amount."
          />
        ) : results.isPending ? (
          <QueueSkeleton rows={2} />
        ) : results.isError ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>The directory could not be searched.</AlertDescription>
          </Alert>
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

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Prepare a payout</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            For everything currently outstanding, less anything already in flight.
          </p>
          <Button loading={prepare.isPending} onClick={() => prepare.mutate()}>
            <HandCoins />
            Prepare
          </Button>
        </CardContent>
      </Card>

      {payouts.isPending ? (
        <QueueSkeleton rows={2} />
      ) : payouts.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>Their payouts could not be loaded.</AlertDescription>
        </Alert>
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
                  <Button
                    loading={release.isPending && release.variables?.id === payout.id}
                    onClick={() => release.mutate(payout)}
                  >
                    <Send />
                    Release {formatNaira(payout.amountKobo)}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
