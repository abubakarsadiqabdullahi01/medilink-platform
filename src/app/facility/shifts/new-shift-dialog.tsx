'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { useReference } from '@/lib/ui/reference';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatNaira } from '@/components/app/format';

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
  const [shiftType, setShiftType] = useState('DAY');
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

  const hourlyRateKobo = Math.round(Number(rateNaira || '0') * 100);
  const hours =
    startsAt && endsAt
      ? (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000
      : 0;
  const estimate = hours > 0 ? hourlyRateKobo * hours * Number(headcount || '1') : 0;

  const publish = useMutation({
    mutationFn: async () => {
      const created = await api.post<{ id: string }>('/api/v1/service-requests', {
        facilityId,
        professionalCategoryId: categoryId,
        specialtyId: specialtyId || undefined,
        shiftType,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
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

  const ready =
    categoryId && startsAt && endsAt && hours > 0 && hourlyRateKobo > 0 && terms.trim().length >= 10;

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
            Created and published in one step. A published shift can be offered to practitioners
            and cannot have its terms changed afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Profession</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
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

          <div className="space-y-1.5">
            <Label htmlFor="startsAt">Starts</Label>
            <Input
              id="startsAt"
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="endsAt">Ends</Label>
            <Input
              id="endsAt"
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Shift type</Label>
            <Select value={shiftType} onValueChange={setShiftType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DAY">Day</SelectItem>
                <SelectItem value="NIGHT">Night</SelectItem>
              </SelectContent>
            </Select>
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
              value={headcount}
              onChange={(event) => setHeadcount(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rate">Hourly rate (naira)</Label>
            <Input
              id="rate"
              type="number"
              min={0}
              step={100}
              value={rateNaira}
              onChange={(event) => setRateNaira(event.target.value)}
            />
          </div>

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
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
            />
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
              before any allowance — those are Stage 8.
            </span>
          </div>
        ) : null}

        {startsAt && endsAt && hours <= 0 ? (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertDescription>A shift has to end after it starts.</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={publish.isPending} onClick={() => publish.mutate()}>
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
