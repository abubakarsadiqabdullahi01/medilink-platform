'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Percent, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatNaira } from '@/components/app/format';

export interface RateCard {
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
  { key: 'nightMultiplierBp' as const, label: 'Night', hint: '20:00 to 06:00 WAT.' },
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

/**
 * Creating a rate card, or "editing" one.
 *
 * There is no edit here, by design — see `RatesPage`'s own description: "a
 * new card supersedes the old one. The old is kept, because an invoice raised
 * against it has to stay readable." So the edit path this dialog offers is
 * exactly what that sentence allows: it opens pre-filled with the current
 * card's numbers, and saving still creates a new one rather than mutating the
 * old, which is the only way "fixing a mistake in the current card" can work
 * without an invoice quietly changing what it was raised against.
 */
export function RateCardDialog({
  facilityId,
  editing,
  trigger,
}: {
  facilityId: string;
  editing?: RateCard;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const [name, setName] = useState(editing ? `${editing.name} (updated)` : '');
  const [multiples, setMultiples] = useState<Record<string, string>>({
    nightMultiplierBp: String((editing?.nightMultiplierBp ?? PAR) / PAR),
    holidayMultiplierBp: String((editing?.holidayMultiplierBp ?? PAR) / PAR),
    overtimeMultiplierBp: String((editing?.overtimeMultiplierBp ?? PAR) / PAR),
    onCallMultiplierBp: String((editing?.onCallMultiplierBp ?? PAR) / PAR),
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
      setOpen(false);
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
  const ready = !invalid && name.trim().length >= 3;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && !editing) setName('');
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Update the rate card' : 'Set your allowances'}</DialogTitle>
          <DialogDescription>
            A new card supersedes {editing ? 'this' : 'the current'} one. The old is kept, because
            an invoice raised against it has to stay readable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rate-card-name">Name it</Label>
            <Input
              id="rate-card-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Nights and holidays, from October"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {BANDS.map((band) => (
              <div key={band.key} className="space-y-1.5">
                <Label htmlFor={`rate-${band.key}`}>{band.label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`rate-${band.key}`}
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>
            <Percent />
            Make it active
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
