'use client';

import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatMinutes, formatNaira } from '@/components/app/format';
import { DEFAULT_INVITATION_HOURS } from '@/modules/matching/domain/assignment';

/**
 * What an offer says, read back before it is sent.
 *
 * An offer is the one step on this page that cannot be taken back one person at a time — there is
 * no way to withdraw a single offer; cancelling the whole shift withdraws every one still waiting.
 * So before it goes, the scheduler sees who it is going to, what the work is, and what it pays.
 * Nothing about that is new information: it is the shift they published and the people they
 * ticked, set side by side so a wrong tick is caught here and not by the practitioner.
 */
export function OfferReviewDialog({
  open,
  onOpenChange,
  shiftLabel,
  windowLabel,
  minutes,
  hourlyRateKobo,
  terms,
  people,
  sending,
  error,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Medical Doctor · Paediatrics · Registrar". */
  shiftLabel: string;
  /** Already formatted, in Lagos time. */
  windowLabel: string;
  minutes: number;
  hourlyRateKobo: number;
  /** The cancellation terms the practitioner is shown before they say yes, when the shift has them. */
  terms?: string | null;
  /** Initials, as the match shows them: a ranking is not a directory. */
  people: { userId: string; name: string }[];
  sending: boolean;
  error: unknown;
  onSend: () => void;
}) {
  const perPersonKobo = Math.round((hourlyRateKobo * minutes) / 60);

  return (
    <Dialog open={open} onOpenChange={(next) => (sending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Offer this shift to{' '}
            {people.length === 1 ? 'one practitioner' : `${people.length} practitioners`}
          </DialogTitle>
          <DialogDescription>
            Check who it is going to and what it says. Nobody is booked until they accept and you
            confirm.
          </DialogDescription>
        </DialogHeader>

        <dl className="divide-y rounded-lg border">
          <Row label="To">
            <ul className="space-y-0.5">
              {people.map((person) => (
                <li key={person.userId} className="font-medium">
                  {person.name}
                </li>
              ))}
            </ul>
          </Row>
          <Row label="Work">{shiftLabel}</Row>
          <Row label="When (Lagos time)">
            {windowLabel}
            <span className="block text-sm text-muted-foreground">{formatMinutes(minutes)}</span>
          </Row>
          <Row label="Pay">
            <span className="tabular">{formatNaira(hourlyRateKobo)} an hour</span>
            <span className="block text-sm text-muted-foreground">
              <span className="tabular">{formatNaira(perPersonKobo)}</span> each at the base rate.
              Night and public-holiday hours are multiplied by this facility&rsquo;s rate card, so
              the invoice can come to more.
            </span>
          </Row>
          {terms?.trim() ? (
            <Row label="If somebody cancels">
              <span className="whitespace-pre-wrap">{terms.trim()}</span>
              <span className="block text-sm text-muted-foreground">
                They see this before they say yes.
              </span>
            </Row>
          ) : null}
        </dl>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Each person has {DEFAULT_INVITATION_HOURS} hours to answer. An offer cannot be taken back
          one person at a time; cancelling the shift withdraws every offer still waiting.
        </p>

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription className="space-y-1">
              <p className="font-medium">The offer was not sent.</p>
              <p>{errorMessage(error)}</p>
              <p>Your choices are kept. Change them and try again.</p>
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="sticky -bottom-6 -mx-6 -mb-6 border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Back and change
          </Button>
          <Button onClick={onSend} loading={sending}>
            Send the offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-base leading-relaxed [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
