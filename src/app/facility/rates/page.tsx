'use client';

import { useQuery } from '@tanstack/react-query';
import { Pencil, Percent, PlusCircle } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { ErrorState } from '@/components/app/states';
import { formatDate } from '@/components/app/format';
import { RateCardDialog, type RateCard } from './rate-card-dialog';

/** 10000 basis points is 1.0×: the rate as agreed, with nothing added. */
const PAR = 10_000;

const BANDS = [
  { key: 'nightMultiplierBp' as const, label: 'Night' },
  { key: 'holidayMultiplierBp' as const, label: 'Public holiday' },
  { key: 'overtimeMultiplierBp' as const, label: 'Overtime' },
  { key: 'onCallMultiplierBp' as const, label: 'On call' },
];

/** Basis points in, "1.5×" out. */
const asMultiple = (bp: number) => `${(bp / PAR).toFixed(2).replace(/\.00$/, '')}×`;

/**
 * A facility's allowances — the list, with creating and "editing" both
 * reached through `RateCardDialog` rather than sharing this screen with it.
 */
export default function RatesPage() {
  const facilityId = useFacilityId();

  const cards = useQuery({
    queryKey: ['rate-cards', facilityId],
    queryFn: () =>
      api.get<{ rateCards: RateCard[] }>(`/api/v1/rate-cards?facilityId=${facilityId}`),
    enabled: Boolean(facilityId),
  });

  return (
    <>
      <PageHeader
        title="Rates and allowances"
        description="What this facility pays above the agreed hourly rate. Everything defaults to the rate as agreed — set a multiple only where you mean to pay more."
        action={
          facilityId ? (
            <RateCardDialog
              facilityId={facilityId}
              trigger={
                <Button>
                  <PlusCircle />
                  New rate card
                </Button>
              }
            />
          ) : null
        }
      />

      {cards.isPending ? (
        <QueueSkeleton rows={2} />
      ) : cards.isError ? (
        <ErrorState
          error={cards.error}
          onRetry={() => void cards.refetch()}
          retrying={cards.isFetching}
        />
      ) : cards.data.rateCards.length === 0 ? (
        <EmptyState
          icon={<Percent />}
          title="No rate card set"
          description="Shifts are invoiced at exactly the rate agreed when they were published, with no allowances."
        />
      ) : (
        <div className="space-y-3">
          {cards.data.rateCards.map((card) => (
            <Card key={card.id}>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{card.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      From {formatDate(card.effectiveFrom)}
                      {card.effectiveUntil ? ` until ${formatDate(card.effectiveUntil)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {card.status === 'ACTIVE' && facilityId ? (
                      <RateCardDialog
                        facilityId={facilityId}
                        editing={card}
                        trigger={
                          <Button variant="outline" size="sm">
                            <Pencil />
                            Edit
                          </Button>
                        }
                      />
                    ) : null}
                    <StatusBadge status={card.status} />
                  </div>
                </div>

                <Separator className="my-3" />

                <div className="flex flex-wrap gap-2">
                  {BANDS.map((band) => (
                    <Badge
                      key={band.key}
                      variant={card[band.key] > PAR ? 'default' : 'secondary'}
                    >
                      {band.label} {asMultiple(card[band.key])}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
