'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleAlert, Info } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/app/field';
import { formatDate } from '@/components/app/format';
import { isRecordChecked, type Submission } from '@/app/admin/practitioners/submissions';
import { canDecide, isAwaitingPractitioner, type CredentialDecision } from './credential-status';

/**
 * What a decision on a credential means, said before it is made.
 *
 * The three outcomes were three buttons that acted on one click: "Reject" sent the practitioner
 * back to their form, and nothing on the screen said so. Each now opens a confirmation that
 * names the credential and the person, says what happens next, and says whether it can be taken
 * back — in the words the code supports and no further:
 *
 * - **Verify** and **Reject** cannot be reversed from any screen. The practitioner can send a new
 *   submission after a rejection; a verification stands until its expiry date passes.
 * - **Ask for more** is not final. The practitioner replies and it comes back to the queue as
 *   pending. It is the middle answer, and it is the only one a reviewer can give without
 *   deciding.
 *
 * `ConfirmDialog` has one way of saying "you can undo this", which would be untrue of the third.
 * `DecisionDialog` carries the same three facts with the wording supplied by the caller.
 */

export interface Reversibility {
  /** `final`: nothing on any screen takes it back. `open`: there is a way on from here. */
  tone: 'final' | 'open';
  label: string;
  detail?: string;
}

export function DecisionDialog({
  open,
  onOpenChange,
  title,
  object,
  consequence,
  reversibility,
  confirmLabel,
  destructive = false,
  loading = false,
  error = null,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What this is about, as a fact: "Professional Indemnity Cover · Amina Yusuf". */
  object: ReactNode;
  consequence: ReactNode;
  reversibility: Reversibility;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  /** Why the last attempt failed. The dialog stays open on failure, with everything typed. */
  error?: string | null;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const final = reversibility.tone === 'final';
  return (
    <Dialog open={open} onOpenChange={(next) => (loading ? undefined : onOpenChange(next))}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          // Enter on a dialog that has just opened must never be the thing that does the harm.
          if (!final) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement)
            .querySelector<HTMLElement>('[data-decision-cancel]')
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
          <div className="space-y-2 leading-relaxed">{consequence}</div>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            {final ? (
              <CircleAlert
                className="mt-0.5 size-4 shrink-0 text-destructive-text"
                aria-hidden="true"
              />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              <span
                className={
                  final ? 'font-semibold text-destructive-text' : 'font-medium text-foreground'
                }
              >
                {reversibility.label}
              </span>
              {reversibility.detail ? ` ${reversibility.detail}` : null}
            </span>
          </p>
          {children}
          {error ? (
            <p
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
            data-decision-cancel
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DecisionSubject = Pick<
  Submission,
  'id' | 'status' | 'credentialTypeName' | 'verificationMethod' | 'credentialTypeExpires'
>;

const DONE: Record<CredentialDecision, string> = {
  approve: 'Credential verified',
  reject: 'Credential rejected',
  request_info: 'More information requested',
};

/**
 * The decision controls for one submission: a reason, the expiry date on the document, and the
 * three outcomes. Used in the queue's review panel and, inline, on a practitioner's own page, so
 * the two cannot drift apart.
 *
 * A NIN or a licence number is the exception: approving one has to *record* an identity or a
 * registration, which is done on the practitioner's page beside the photograph, so "Verify" is
 * replaced by the way there (`confirmRecord`). Rejecting it or asking for more is the same here.
 */
export function CredentialDecision({
  submission,
  practitionerName,
  userId,
  confirmRecord,
  onDecided,
}: {
  submission: DecisionSubject;
  practitionerName: string;
  userId: string;
  confirmRecord: { href: string; label: string } | { onClick: () => void; label: string };
  /** After a decision is recorded: close the panel it was in. */
  onDecided?: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  // The expiry date the reviewer reads off a document.
  const [printed, setPrinted] = useState('');
  const [deciding, setDeciding] = useState<CredentialDecision | null>(null);
  const reason = note.trim();

  const review = useMutation({
    mutationFn: (decision: CredentialDecision) =>
      api.post(`/api/v1/credentials/${submission.id}/review`, {
        decision,
        reviewNotes: reason || undefined,
        // Only sent with an approval: an expiry is recorded when a credential is approved, and
        // the server refuses it with anything else.
        printedExpiryDate: decision === 'approve' ? printed || undefined : undefined,
      }),
    onSuccess: (_result, decision) => {
      toast.success(DONE[decision]);
      setDeciding(null);
      onDecided?.();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['credentials'] });
      void queryClient.invalidateQueries({ queryKey: ['practitioner-credentials', userId] });
      // Verifying the last mandatory one can make somebody eligible, so the card that says
      // whether they can work has to be asked again.
      void queryClient.invalidateQueries({ queryKey: ['eligibility-of', userId] });
      void queryClient.invalidateQueries({ queryKey: ['practitioner-directory'] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
    },
  });

  // A fresh attempt starts without the last one's error.
  useEffect(() => {
    if (deciding === null) review.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deciding]);

  if (isAwaitingPractitioner(submission.status)) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-sm">
        Waiting for {practitionerName} to reply. They can send a new reference or document, and it
        comes back to this queue as pending.
      </p>
    );
  }
  if (!canDecide(submission.status)) return null;

  const recordChecked = isRecordChecked(submission);
  const asksForExpiry = submission.credentialTypeExpires && !recordChecked;
  const object = `${submission.credentialTypeName} · ${practitionerName}`;

  const yourNote = reason ? (
    <blockquote className="rounded-md bg-muted px-3 py-2 text-sm [overflow-wrap:anywhere]">
      <span className="block text-sm font-medium text-muted-foreground">
        Your note — they see this
      </span>
      {reason}
    </blockquote>
  ) : null;

  return (
    <div className="space-y-4">
      <Field
        label="Reason"
        hint="Required to reject or to ask for more: it is what tells them what to fix, and they see it."
      >
        <Textarea
          rows={2}
          placeholder="What is wrong, or what is missing."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      {asksForExpiry ? (
        <Field
          label="Expiry date on the document"
          optional
          hint="Read it off the document. If none is printed, leave it empty and an estimate is used."
        >
          <Input
            type="date"
            className="max-w-xs"
            value={printed}
            onChange={(event) => setPrinted(event.target.value)}
          />
        </Field>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {recordChecked ? (
          'href' in confirmRecord ? (
            <Link
              href={confirmRecord.href}
              className={buttonVariants({ variant: 'success' })}
              aria-label={`${confirmRecord.label}: ${object}`}
            >
              {confirmRecord.label}
            </Link>
          ) : (
            <Button variant="success" onClick={confirmRecord.onClick}>
              {confirmRecord.label}
            </Button>
          )
        ) : (
          <Button
            variant="success"
            aria-label={`Verify ${object}`}
            onClick={() => setDeciding('approve')}
          >
            Verify
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!reason}
          aria-label={`Ask for more on ${object}`}
          onClick={() => setDeciding('request_info')}
        >
          Ask for more
        </Button>
        <Button
          variant="destructive"
          disabled={!reason}
          aria-label={`Reject ${object}`}
          onClick={() => setDeciding('reject')}
        >
          Reject
        </Button>
      </div>
      {!reason ? (
        <p className="text-sm text-muted-foreground">
          Write a reason above to ask for more or to reject.
        </p>
      ) : null}

      <DecisionDialog
        open={deciding === 'approve'}
        onOpenChange={(next) => !next && setDeciding(null)}
        title="Verify this credential"
        object={object}
        consequence={
          <>
            <p>
              It counts as verified, toward whether {practitionerName} can be offered work, and they
              are told.
            </p>
            {asksForExpiry ? (
              <p>
                {printed
                  ? `Its expiry is recorded as ${formatDate(printed)}, the date you read off the document.`
                  : 'No expiry date was entered, so an estimate from the credential type is used.'}
              </p>
            ) : null}
          </>
        }
        reversibility={{
          tone: 'final',
          label: 'This cannot be undone from here.',
          detail: 'A verified credential stands until its expiry date passes.',
        }}
        confirmLabel="Verify credential"
        loading={review.isPending}
        error={review.isError ? errorMessage(review.error) : null}
        onConfirm={() => review.mutate('approve')}
      />

      <DecisionDialog
        open={deciding === 'request_info'}
        onOpenChange={(next) => !next && setDeciding(null)}
        title="Ask for more information"
        object={object}
        consequence={
          <>
            <p>
              It stays open, not rejected. {practitionerName} is told, and they can reply with a new
              reference number or document.
            </p>
            {yourNote}
          </>
        }
        reversibility={{
          tone: 'open',
          label: 'Not final.',
          detail: 'When they reply it comes back to this queue as pending.',
        }}
        confirmLabel="Ask for more information"
        loading={review.isPending}
        error={review.isError ? errorMessage(review.error) : null}
        onConfirm={() => review.mutate('request_info')}
      />

      <DecisionDialog
        open={deciding === 'reject'}
        onOpenChange={(next) => !next && setDeciding(null)}
        title="Reject this credential"
        object={object}
        consequence={
          <>
            <p>
              {practitionerName} is told it was rejected. If this credential is mandatory for their
              profession and they had already submitted for approval, their application is also sent
              back to them to fix and submit again.
            </p>
            {yourNote}
          </>
        }
        reversibility={{
          tone: 'final',
          label: 'This cannot be undone from here.',
          detail: 'They can send a new submission.',
        }}
        destructive
        confirmLabel="Reject credential"
        loading={review.isPending}
        error={review.isError ? errorMessage(review.error) : null}
        onConfirm={() => review.mutate('reject')}
      />
    </div>
  );
}
