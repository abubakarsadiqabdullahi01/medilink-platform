'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Percent, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useFacilityId } from '@/lib/ui/facility';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { StatusBadge } from '@/components/app/status-badge';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatDate, formatNaira } from '@/components/app/format';

interface RateCard {
  id: string;
  name: string;
  status: string;
  nightMultiplierBp: number;
  holidayMultiplierBp: number;
  overtimeMultiplierBp: number;
  onCallMultiplierBp: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

/** 10000 basis points is 1.0×: the rate as agreed, with nothing added. */
const PAR = 10_000;

const BANDS = [
  {
    key: 'nightMultiplierBp' as const,
    label: 'Night',
    hint: '20:00 to 06:00 WAT.',
  },
  {
    key: 'holidayMultiplierBp' as const,
    label: 'Public holiday',
    hint: 'Takes precedence over night — the two never compound.',
  },
  {
    key: 'overtimeMultiplierBp' as const,
    label: 'Overtime',
    hint: 'Beyond the length of the shift that was accepted. Adds to the band rate.',
  },
  {
    key: 'onCallMultiplierBp' as const,
    label: 'On call',
    hint: 'Hours held available rather than worked.',
  },
];

/** Basis points in, "1.5×" out. */
const asMultiple = (bp: number) => `${(bp / PAR).toFixed(2).replace(/\.00$/, '')}×`;

/**
 * A facility's allowances.
 *
 * Entered as a multiple because that is how people talk about them, and
 * stored as basis points because money is integer kobo and a float multiplier
 * would put a fraction back into it. The worked example under the form is
 * there because "1.5×" and "what that costs me" are different questions, and
 * the second is the one being decided.
 */
export default function RatesPage() {
  const facilityId = useFacilityId();
  const queryClient = useQueryClient();

  const cards = useQuery({
    queryKey: ['rate-cards', facilityId],
    queryFn: () =>
      api.get<{ rateCards: RateCard[] }>(`/api/v1/rate-cards?facilityId=${facilityId}`),
    enabled: Boolean(facilityId),
  });

  const active = cards.data?.rateCards.find((row) => row.status === 'ACTIVE');

  const [name, setName] = useState('');
  const [multiples, setMultiples] = useState<Record<string, string>>({
    nightMultiplierBp: '1',
    holidayMultiplierBp: '1',
    overtimeMultiplierBp: '1',
    onCallMultiplierBp: '1',
  });

  const save = useMutation({
    mutationFn: () =>
      api.post('/api/v1/rate-cards', {
        facilityId,
        name: name.trim(),
        ...Object.fromEntries(
          BANDS.map((band) => [band.key, Math.round(Number(multiples[band.key] ?? '1') * PAR)]),
        ),
      }),
    onSuccess: () => {
      toast.success('Rate card active', {
        description: 'It prices every shift invoiced from now on.',
      });
      void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
      setName('');
    },
    onError: (error) => toast.error('Could not save it', { description: errorMessage(error) }),
  });

  const invalid = BANDS.some((band) => {
    const value = Number(multiples[band.key] ?? '1');
    return !Number.isFinite(value) || value < 1 || value > 5;
  });

  /** One eight-hour night shift at ₦5,000, so the effect is a number. */
  const example = Math.round(8 * 500_000 * Number(multiples.nightMultiplierBp ?? '1'));

  return (
    <>
      <PageHeader
        title="Rates and allowances"
        description="What this facility pays above the agreed hourly rate. Everything defaults to the rate as agreed — set a multiple only where you mean to pay more."
      />

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {active ? 'Replace the current card' : 'Set your allowances'}
          </CardTitle>
          <CardDescription>
            A new card supersedes the old one. The old is kept, because an invoice raised against
            it has to stay readable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name it</Label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Nights and holidays, from October"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {BANDS.map((band) => (
              <div key={band.key} className="space-y-1.5">
                <Label htmlFor={band.key}>{band.label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={band.key}
                    type="number"
                    min={1}
                    max={5}
                    step={0.05}
                    value={multiples[band.key] ?? '1'}
                    onChange={(event) =>
                      setMultiples((current) => ({ ...current, [band.key]: event.target.value }))
                    }
                    className="w-28"
                  />
                  <span className="text-sm text-muted-foreground">× the agreed rate</span>
                </div>
                <p className="text-xs text-muted-foreground">{band.hint}</p>
              </div>
            ))}
          </div>

          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            An eight-hour night shift at ₦5,000 an hour would cost{' '}
            <strong>{formatNaira(example)}</strong>
            {Number(multiples.nightMultiplierBp ?? '1') === 1 ? ' — the rate as agreed.' : '.'}
          </div>

          {invalid ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertDescription>
                A multiple below 1 would be a rate cut rather than an allowance, and above 5 is
                almost certainly a misplaced decimal point. Both are refused.
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            disabled={!facilityId || name.trim().length < 3 || invalid}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            <Percent />
            Make it active
          </Button>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-medium">Cards this facility has had</h2>

      {cards.isPending ? (
        <QueueSkeleton rows={2} />
      ) : cards.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>Rate cards could not be loaded.</AlertDescription>
        </Alert>
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
                  <StatusBadge status={card.status} />
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
