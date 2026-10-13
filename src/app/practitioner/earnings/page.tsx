'use client';

import { useQuery } from '@tanstack/react-query';
import { TriangleAlert, Wallet } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { AmountFigure } from '@/components/app/amount-figure';
import { StatusBadge } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatDate, formatNaira } from '@/components/app/format';

interface Payout {
  id: string;
  amountKobo: number;
  status: string;
  providerReference: string | null;
  failureReason: string | null;
  releasedAt: string | null;
  settledAt: string | null;
  createdAt: string;
}

/**
 * What the platform owes this practitioner, and what it has already paid.
 *
 * The timesheets page shows each shift at its agreed rate, but says — rightly
 * — that this is not what is credited: the facility's rate card prices night
 * and holiday hours when the shift is invoiced, and the platform's share comes
 * off then too. So until now a practitioner could see every shift they had
 * worked and not one naira they were owed.
 *
 * The owed figure is the ledger's own balance for them, not a sum this page
 * does over rows it happens to have loaded, so it cannot disagree with what
 * finance will actually pay.
 */
export default function EarningsPage() {
  const earnings = useQuery({
    queryKey: ['my-earnings'],
    queryFn: () =>
      api.get<{ payouts: Payout[]; owedKobo: number; heldKobo: number }>(
        '/api/v1/payouts?scopeType=SELF',
      ),
  });

  const payouts = earnings.data?.payouts ?? [];
  const inFlight = payouts.filter((row) => row.status === 'PREPARED' || row.status === 'RELEASED');
  const inFlightKobo = inFlight.reduce((sum, row) => sum + row.amountKobo, 0);
  const paidKobo = payouts
    .filter((row) => row.status === 'SETTLED')
    .reduce((sum, row) => sum + row.amountKobo, 0);

  return (
    <>
      <PageHeader
        title="Earnings"
        description="What you are owed for shifts that have been approved and invoiced, and every payment made to you."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <AmountFigure
          label="Owed to you"
          amountKobo={earnings.data?.owedKobo ?? 0}
          hint={
            (earnings.data?.heldKobo ?? 0) > 0
              ? `${formatNaira(earnings.data!.heldKobo)} of this is held while a dispute is decided.`
              : 'Approved, invoiced and not yet paid out.'
          }
          isPending={earnings.isPending}
          isError={earnings.isError}
          emphasise
        />
        <AmountFigure
          label="On its way"
          amountKobo={inFlightKobo}
          hint={
            inFlight.length === 0
              ? 'No payment is being made right now.'
              : 'Prepared or sent, not yet confirmed received.'
          }
          isPending={earnings.isPending}
          isError={earnings.isError}
        />
        <AmountFigure
          label="Paid to you"
          amountKobo={paidKobo}
          hint="Every payment confirmed, all time."
          isPending={earnings.isPending}
          isError={earnings.isError}
        />
      </div>

      <Alert variant="info" className="mb-6">
        <AlertDescription>
          A shift is credited here when it is invoiced, not when it is approved — that is when the
          facility&rsquo;s rate card prices its night and holiday hours. An approved shift that is
          not here yet is waiting for the next invoice.
        </AlertDescription>
      </Alert>

      <h2 className="mb-3 text-sm font-medium">Payments</h2>

      {earnings.isPending ? (
        <QueueSkeleton rows={2} />
      ) : earnings.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>Your earnings could not be loaded.</AlertDescription>
        </Alert>
      ) : payouts.length === 0 ? (
        <EmptyState
          icon={<Wallet />}
          title="No payments yet"
          description="Each payment to you appears here, with where it has got to."
        />
      ) : (
        <div className="space-y-3">
          {payouts.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                <div className="min-w-0">
                  <p className="tabular font-medium">{formatNaira(row.amountKobo)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.settledAt
                      ? `Received ${formatDate(row.settledAt)}`
                      : row.releasedAt
                        ? `Sent ${formatDate(row.releasedAt)}`
                        : `Prepared ${formatDate(row.createdAt)}`}
                    {row.providerReference ? ` · ref ${row.providerReference}` : ''}
                  </p>
                  {row.failureReason ? (
                    <p className="mt-1 text-xs text-destructive-text">{row.failureReason}</p>
                  ) : null}
                </div>
                <StatusBadge status={row.status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
