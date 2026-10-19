'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
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
import { MoneyInput } from '@/components/app/money-input';
import { FieldError } from '@/components/app/field-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatNaira } from '@/components/app/format';
import { lagosLocalToInstant } from '@/lib/lagos-date';
import { deriveShiftType } from '@/modules/service-requests/domain/shift-type';

/**
 * Publishing a shift.
 *
 * Two steps in one dialogue, because they are one act to the person doing
 * them: a request is created as a DRAFT and then published. Splitting them in
 * the interface would leave drafts nobody meant to keep.
 *
 * The rate is entered in **naira** and sent in **kobo**. Rule 3 says money is
 * only ever integer kobo, and this is the boundary — a scheduler thinking in
 * naira is not a reason to put a float in the database.
 */
export function NewShiftDialog({ facilityId }: { facilityId: string }) {
  const [open, setOpen] = useState(false);
  const reference = useReference();
  const queryClient = useQueryClient();

  const [categoryId, setCategoryId] = useState('');
  const [specialtyId, setSpecialtyId] = useState<string>('');
  const [levelId, setLevelId] = useState('');
  const [supervised, setSupervised] = useState(false);
  const [urgency, setUrgency] = useState('ROUTINE');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [headcount, setHeadcount] = useState('1');
  const [rateNaira, setRateNaira] = useState('5000');
  const [terms, setTerms] = useState(
    'Either party may cancel up to 24 hours before the shift without penalty.',
  );
  const [notes, setNotes] = useState('');

  const specialties = (reference.data?.specialties ?? []).filter(
    (row) => row.categoryId === categoryId,
  );
  // Levels the profession has defined (REQ-01). Once it has any, a shift has to say which.
  const levels = (reference.data?.cadreLevels ?? []).filter((row) => row.categoryId === categoryId);

  const hourlyRateKobo = Math.round(Number(rateNaira || '0') * 100);
  const hours =
    startsAt && endsAt
      ? (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000
      : 0;
  const estimate = hours > 0 ? hourlyRateKobo * hours * Number(headcount || '1') : 0;
  // Day or night is a fact about the hours and the pay floor follows it, so it is worked out
  // rather than picked (UXF-06). The server works it out again and refuses a label that disagrees.
  const shiftType =
    hours > 0 ? deriveShiftType(lagosLocalToInstant(startsAt), lagosLocalToInstant(endsAt)) : null;

  const publish = useMutation({
    mutationFn: async () => {
      const created = await api.post<{ id: string }>('/api/v1/service-requests', {
        facilityId,
        professionalCategoryId: categoryId,
        specialtyId: specialtyId || undefined,
        cadreLevelId: levelId || undefined,
        supervisionAvailable: supervised,
        startsAt: lagosLocalToInstant(startsAt).toISOString(),
        endsAt: lagosLocalToInstant(endsAt).toISOString(),
        headcount: Number(headcount),
        hourlyRateKobo,
        urgency,
        cancellationTerms: terms,
        notes: notes.trim() || undefined,
      });

      // Created as a DRAFT; publishing is what opens it to invitations. The
      // gate rules — a verified facility, a licence that has not lapsed —
      // are checked here rather than at creation.
      await api.post(`/api/v1/service-requests/${created.id}/publish`, { facilityId });
      return created;
    },
    onSuccess: () => {
      toast.success('Shift published', { description: 'It can now be offered to practitioners.' });
      void queryClient.invalidateQueries({ queryKey: ['shifts'] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
      setOpen(false);
    },
    onError: (error) => toast.error('Could not publish', { description: errorMessage(error) }),
  });

  // What is wrong with what has been typed, said next to the field; and, separately, what has not
  // been typed yet. A disabled button that gives no reason is the form telling you "no" without
  // saying why, so both are listed beside it.
  const headcountValue = Number(headcount);
  const problems = {
    end: startsAt && endsAt && hours <= 0 ? 'A shift has to end after it starts.' : null,
    headcount:
      !Number.isInteger(headcountValue) || headcountValue < 1 ? 'At least one person is needed.' : null,
    rate: rateNaira !== '' && hourlyRateKobo <= 0 ? 'Enter an hourly rate above ₦0.' : null,
    terms:
      terms.length > 0 && terms.trim().length < 10 ? 'Say a little more: at least 10 characters.' : null,
  };
  const missing = [
    !categoryId && 'the profession',
    categoryId && levels.length > 0 && !levelId && 'the level',
    !startsAt && 'when it starts',
    !endsAt && 'when it ends',
    rateNaira === '' && 'the hourly rate',
    terms.trim().length === 0 && 'the cancellation terms',
  ].filter((item): item is string => Boolean(item));

  const ready =
    categoryId &&
    (levels.length === 0 || levelId) &&
    startsAt &&
    endsAt &&
    hours > 0 &&
    headcountValue >= 1 &&
    Number.isInteger(headcountValue) &&
    hourlyRateKobo > 0 &&
    terms.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CalendarPlus />
          Publish a shift
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publish a shift</DialogTitle>
          <DialogDescription>
            Created and published in one step. A published shift can be offered to practitioners and
            cannot have its terms changed afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Profession</Label>
            <Select
              value={categoryId}
              onValueChange={(value) => {
                setCategoryId(value);
                setSpecialtyId('');
                setLevelId('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {(reference.data?.professionalCategories ?? []).map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Specialty {specialties.length === 0 ? '(none for this category)' : ''}</Label>
            <Select
              value={specialtyId}
              onValueChange={setSpecialtyId}
              disabled={specialties.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                {specialties.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {levels.length > 0 ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Level</Label>
              <Select value={levelId} onValueChange={setLevelId}>
                <SelectTrigger aria-label="Level">
                  <SelectValue placeholder="Which level is this shift for?" />
                </SelectTrigger>
                <SelectContent>
                  {levels.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only practitioners recorded at this level are offered the shift.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="startsAt">Starts</Label>
            <Input
              id="startsAt"
              type="datetime-local"
              aria-invalid={Boolean(problems.end)}
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="endsAt">Ends</Label>
            <Input
              id="endsAt"
              type="datetime-local"
              aria-invalid={Boolean(problems.end)}
              aria-describedby={problems.end ? 'endsAt-error' : undefined}
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
            <div id="endsAt-error">
              <FieldError message={problems.end} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Shift type</Label>
            <p className="flex h-11 items-center rounded-md border bg-muted px-3 text-sm" aria-live="polite">
              {shiftType === null
                ? 'Worked out from the times'
                : shiftType === 'NIGHT'
                  ? 'Night shift — most of it falls between 20:00 and 06:00'
                  : 'Day shift'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Urgency</Label>
            <Select value={urgency} onValueChange={setUrgency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ROUTINE">Routine</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
                <SelectItem value="EMERGENCY">Emergency</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="headcount">People needed</Label>
            <Input
              id="headcount"
              type="number"
              min={1}
              aria-invalid={Boolean(problems.headcount)}
              value={headcount}
              onChange={(event) => setHeadcount(event.target.value)}
            />
            <FieldError message={problems.headcount} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rate">Hourly rate (naira)</Label>
            <MoneyInput
              id="rate"
              aria-invalid={Boolean(problems.rate)}
              value={rateNaira}
              onValueChange={setRateNaira}
            />
            <FieldError message={problems.rate} />
          </div>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="size-4"
              checked={supervised}
              onChange={(event) => setSupervised(event.target.checked)}
            />
            Somebody will be there to supervise on this shift
            <span className="text-xs text-muted-foreground">
              — needed to offer it to a practitioner on a provisional register
            </span>
          </label>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="terms">
              Cancellation terms{' '}
              <span className="font-normal text-muted-foreground">
                — required; this is what a dispute turns on
              </span>
            </Label>
            <Textarea
              id="terms"
              rows={2}
              aria-invalid={Boolean(problems.terms)}
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
            />
            <FieldError message={problems.terms} />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">Notes for the practitioner (optional)</Label>
            <Textarea
              id="notes"
              rows={2}
              placeholder="Ward, who to report to, anything they need to bring."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>

        {hours > 0 ? (
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            {hours} hours × {formatNaira(hourlyRateKobo)} × {headcount} ={' '}
            <strong>{formatNaira(estimate)}</strong>
            <span className="ml-1 text-muted-foreground">
              at the base rate. Night and public-holiday hours are multiplied by this
              facility&rsquo;s rate card, so the invoice can come to more.
            </span>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={publish.isPending} onClick={() => publish.mutate()}>
            Publish
          </Button>
          {/* Why the button is not ready, where the eye goes next. Last in the markup because the
              footer is a reversed column on a phone, which puts it above the buttons; from `sm` up
              it goes to the left of them. */}
          {!ready && missing.length > 0 ? (
            <p
              className="text-xs text-muted-foreground sm:order-first sm:mr-auto sm:self-center"
              aria-live="polite"
            >
              Still to fill in: {missing.join(', ')}.
            </p>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
