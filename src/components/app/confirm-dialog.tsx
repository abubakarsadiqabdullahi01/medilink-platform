'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { CircleAlert, Info, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * How a decision can be taken back, when "You can undo this" or "This cannot be undone" is too
 * blunt. `final`: nothing on any screen takes it back. `open`: there is a way on from here —
 * a reply, a resubmission — that is not an undo.
 */
export interface Reversibility {
  tone: 'final' | 'open';
  label: string;
  detail?: string;
}

/**
 * Asks before something that cannot be quietly taken back, and says what it is asking about.
 *
 * "Are you sure?" does not help anybody decide. A person about to reject a timesheet needs
 * three things in front of them: *which* timesheet, *what will happen* when they say yes,
 * and *whether they can change their mind*. This puts all three on screen, in that order,
 * and nothing else.
 *
 * - The object is named in its own row, so it is read as a fact and not skimmed as prose.
 * - The consequence is a sentence in the person's words, not a restatement of the button.
 * - Reversibility is a label with an icon and words ("You can undo this" / "This cannot be
 *   undone"), so it never rests on colour. Pass a `Reversibility` when neither fits.
 * - Focus starts on **Cancel** for a destructive or irreversible action and on the confirm
 *   button otherwise: Enter on a dialog that has just opened should never be the thing that
 *   does the harm.
 * - A failed attempt is shown inside the dialog (`error`), which stays open with everything the
 *   person typed, so the reason is not lost behind a toast.
 * - The confirm button carries the verb and the noun ("Reject timesheet"), not "OK".
 *
 * It does not run the action. `onConfirm` does, and the dialog stays open, with the button
 * showing progress, until the caller sets `open` false — so a failure leaves the person
 * where they were instead of closing on them.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  object,
  consequence,
  reversible,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  confirmDisabled = false,
  error = null,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What this is about: "Timesheet · Amina Yusuf · 14 Oct 2026, 08:00". */
  object: ReactNode;
  /** What happens next, in a sentence. */
  consequence: ReactNode;
  /** `true`, `false`, the way back in words ("Ask the practitioner to resubmit"), or a `Reversibility`. */
  reversible: boolean | string | Reversibility;
  confirmLabel: string;
  /** When "Cancel" would be confusable with the action itself — "Keep the shift". */
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  /** For a decision that needs something first — a reason. Say what it needs beside the field. */
  confirmDisabled?: boolean;
  /** Why the last attempt failed. Announced; the dialog stays open. */
  error?: string | null;
  onConfirm: () => void;
  /** Extra fields the decision needs: a reason, a step-up prompt. */
  children?: ReactNode;
}) {
  // A tall dialog on a phone shows its failure below the fold; bring it into view when it arrives.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);

  const structured = typeof reversible === 'object' ? reversible : null;
  const final = structured ? structured.tone === 'final' : reversible === false;
  const focusCancel = destructive || final;

  return (
    <Dialog open={open} onOpenChange={(next) => (loading ? undefined : onOpenChange(next))}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          if (!focusCancel) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement)
            .querySelector<HTMLElement>('[data-confirm-cancel]')
            ?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Confirm or cancel. This says what it applies to and what will happen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-base">
          <p className="rounded-md border bg-muted/40 px-3 py-2 font-medium leading-snug [overflow-wrap:anywhere]">
            {object}
          </p>
          <p className="leading-relaxed">{consequence}</p>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            {final ? (
              <CircleAlert
                className="mt-0.5 size-4 shrink-0 text-destructive-text"
                aria-hidden="true"
              />
            ) : structured ? (
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <Undo2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              <span
                className={
                  final ? 'font-semibold text-destructive-text' : 'font-medium text-foreground'
                }
              >
                {structured
                  ? structured.label
                  : reversible === false
                    ? 'This cannot be undone.'
                    : 'You can undo this.'}
              </span>{' '}
              {structured ? structured.detail : typeof reversible === 'string' ? reversible : null}
            </span>
          </p>
          {children}
          {error ? (
            <p
              ref={errorRef}
              role="alert"
              className="flex items-start gap-1.5 text-sm font-medium text-destructive-text"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            data-confirm-cancel
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
