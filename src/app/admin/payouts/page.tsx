'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HandCoins, Send, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatNaira, formatWhen, shortId } from '@/components/app/format';

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
 */
export default function PayoutsPage() {
  const queryClient = useQueryClient();
  const [practitionerId, setPractitionerId] = useState('');

  const payouts = useQuery({
    queryKey: ['payouts', practitionerId],
    queryFn: () =>
      api.get<{ payouts: Payout[] }>(
        `/api/v1/payouts?scopeType=SELF&scopeId=${practitionerId}`,
      ),
    enabled: practitionerId.length === 36,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['payouts'] });
  }

  const prepare = useMutation({
    mutationFn: () => api.post('/api/v1/payouts', { practitionerId }),
    onSuccess: () => {
      toast.success('Prepared', { description: 'Nothing has moved yet. Release it to pay.' });
      refresh();
    },
    onError: (error) => toast.error('Could not prepare it', { description: errorMessage(error) }),
  });

  const release = useMutation({
    mutationFn: (payout: Payout) => api.post(`/api/v1/payouts/${payout.id}/release`),
    onSuccess: () => {
      toast.success('Released to the gateway');
      refresh();
    },
    onError: (error) => toast.error('The gateway refused it', { description: errorMessage(error) }),
  });

  return (
    <>
      <PageHeader
        title="Payouts"
        description="What the ledger says a practitioner is owed, and clearing it. Preparing moves nothing; releasing is the act that does."
      />

      <Alert variant="warning" className="mb-6">
        <TriangleAlert />
        <AlertDescription>
          <strong>No payment provider is configured.</strong> Releasing a payout locally writes the
          ledger entry and returns a reference beginning <code>stub-</code>, so nobody mistakes it
          for a bank one. No money moves until the provider decision is taken.
        </AlertDescription>
      </Alert>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Prepare a payout</CardTitle>
          <CardDescription>
            For everything currently outstanding, less anything already in flight.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[22rem] flex-1 space-y-1.5">
            <Label htmlFor="practitioner">Practitioner</Label>
            <Input
              id="practitioner"
              value={practitionerId}
              onChange={(event) => setPractitionerId(event.target.value.trim())}
              placeholder="Their user id"
              className="font-mono text-xs"
            />
          </div>
          <Button
            disabled={practitionerId.length !== 36 || prepare.isPending}
            loading={prepare.isPending}
            onClick={() => prepare.mutate()}
          >
            <HandCoins />
            Prepare
          </Button>
        </CardContent>
      </Card>

      {practitionerId.length !== 36 ? (
        <EmptyState
          icon={<HandCoins />}
          title="Name a practitioner"
          description="Payouts are per person, and the ledger is what decides the amount."
        />
      ) : payouts.isPending ? (
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
                <div>
                  <p className="tabular text-lg font-semibold">
                    {formatNaira(payout.amountKobo)}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {shortId(payout.practitionerId)}
                  </p>
                </div>
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
