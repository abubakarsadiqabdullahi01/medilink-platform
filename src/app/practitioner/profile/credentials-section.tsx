'use client';

import { useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Clock, FileCheck2, History, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/ui/api';
import {
  credentialNextStep,
  credentialTimeline,
  daysUntilExpiry,
  expiryPhrase,
  expiryTone,
} from '@/lib/ui/credential-timing';
import { useNow } from '@/lib/ui/now';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { nameOf, useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/app/status-badge';
import { type UploadedDocument } from '@/components/app/document-upload';
import { Field } from '@/components/app/field';
import { EmptyState } from '@/components/app/page-shell';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { Timeline } from '@/components/app/timeline';
import {
  EvidenceFields,
  evidenceRule,
  isComplete,
  referenceProblem,
  referenceToSend,
  whatIsMissing,
} from './evidence-fields';
import { expiryOf, formatAgo } from '@/components/app/format';

interface Submission {
  id: string;
  credentialTypeId: string;
  status: string;
  referenceNumber: string | null;
  expiresAt: string | null;
  documentExpiresOn: string | null;
  reviewNotes: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

/** Statuses that mean a credential of this type is already with Medilink. */
const ACTIVE = ['PENDING', 'MORE_INFO_REQUESTED', 'VERIFIED'];

/**
 * Submitting a credential, and seeing what became of it.
 *
 * **What the form asks for depends on the credential.** Some types are
 * verified by looking at a document and some by checking a reference against
 * a register, and the API refuses the wrong one with a 422. The form now
 * knows which is which — `verificationMethod` comes back with the vocabulary
 * — so it asks for the right thing instead of letting somebody discover the
 * rule by being refused.
 *
 * **Every submission says whose move it is.** A badge reading "Pending" does not tell somebody
 * whether to wait or to act, so each card carries a sentence for it, and the ones that need the
 * practitioner come first. The reviewer's note is shown in full on a rejection or a request for
 * more: it is the only thing that tells somebody what to fix, and hiding it behind "contact
 * support" loses the practitioner rather than the document.
 */
export function CredentialsSection({
  professionalCategoryId,
  leading,
}: {
  /** From the profile, so the list can say which documents this profession must have. */
  professionalCategoryId?: string | null;
  /** Shown above the form, in its column — the wizard's "what your profession requires". */
  leading?: ReactNode;
}) {
  const reference = useReference();
  const now = useNow(5 * 60_000);
  const queueKey = ['my-credentials'];
  const queue = useQueue<Submission>(
    queueKey,
    '/api/v1/credentials?scopeType=SELF',
    (body) => (body as { submissions?: Submission[] }).submissions ?? [],
  );

  const [credentialTypeId, setCredentialTypeId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  // The Type control, so "Submit again" can take the person to it.
  const typeTrigger = useRef<HTMLButtonElement>(null);

  const chosen = (reference.data?.credentialTypes ?? []).find((row) => row.id === credentialTypeId);
  // What this credential has to be sent with — and, while no provider can check
  // a number itself, a photograph an officer can read beside it.
  const rule = evidenceRule(chosen?.verificationMethod ?? '', reference.data?.verification);

  // A type that is already pending, queried or verified cannot be submitted
  // again — the server refuses a second one, and the old list let somebody
  // pick it, upload a file and be told no. They are shown, ticked and
  // disabled, so the list still reads as a checklist of what is done.
  const taken = new Map(
    (queue.data ?? [])
      .filter((row) => ACTIVE.includes(row.status))
      .map((row) => [row.credentialTypeId, row.status]),
  );
  const types = reference.data?.credentialTypes ?? [];
  const requiredHere = (typeId: string) =>
    Boolean(professionalCategoryId) &&
    (types.find((row) => row.id === typeId)?.requiredForCategoryIds ?? []).includes(
      professionalCategoryId!,
    );
  const ordered = [...types].sort(
    (a, b) =>
      Number(requiredHere(b.id)) - Number(requiredHere(a.id)) || a.name.localeCompare(b.name),
  );
  const allTaken = ordered.length > 0 && ordered.every((row) => taken.has(row.id));

  function resetForm() {
    setCredentialTypeId('');
    setReferenceNumber('');
    setDocument(null);
  }

  const submit = useQueueAction<void>({
    onDone: () => {
      setSent(chosen?.name ?? 'Your credential');
      resetForm();
    },
    queueKey,
    run: () =>
      api.post('/api/v1/credentials', {
        credentialTypeId,
        referenceNumber: referenceToSend(rule, referenceNumber),
        documentObjectKey: document?.objectKey,
      }),
    success: 'Submitted for review',
  });

  const ready = isComplete(rule, referenceNumber, document);
  const missing = chosen ? whatIsMissing(rule, referenceNumber, document) : null;

  // Those that need the practitioner come first; the order the API gave holds within each.
  const submissions = [...(queue.data ?? [])].sort(
    (a, b) =>
      Number(credentialNextStep(b.status).theirMove) -
      Number(credentialNextStep(a.status).theirMove),
  );

  return (
    // The form on the left and what has become of earlier submissions on the
    // right, so a wide screen shows both without scrolling past one to reach
    // the other; on a phone they stack, form first.
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="min-w-0 space-y-6">
        {leading}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Submit a credential</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {reference.isError ? (
              <ErrorState
                compact
                error={reference.error}
                onRetry={() => void reference.refetch()}
                retrying={reference.isFetching}
              />
            ) : (
              <Field
                label="Type"
                required
                hint="Choose what you are sending. Ones already with Medilink are greyed out."
              >
                {(a11y) => (
                  <Select
                    value={credentialTypeId}
                    onValueChange={(value) => {
                      setCredentialTypeId(value);
                      setSent(null);
                      // What the form asks for changes with the type, so anything
                      // already entered no longer belongs to the question.
                      setReferenceNumber('');
                      setDocument(null);
                    }}
                  >
                    <SelectTrigger {...a11y} ref={typeTrigger}>
                      <SelectValue placeholder="Choose one" />
                    </SelectTrigger>
                    <SelectContent>
                      {ordered.map((row) => {
                        const state = taken.get(row.id);
                        return (
                          <SelectItem key={row.id} value={row.id} disabled={Boolean(state)}>
                            {row.name}
                            {requiredHere(row.id) ? ' · required' : ''}
                            {state
                              ? ` · ${state === 'VERIFIED' ? 'verified' : state === 'PENDING' ? 'submitted, awaiting review' : 'reviewer asked for more'}`
                              : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}

            {chosen ? (
              <EvidenceFields
                rule={rule}
                idPrefix="submit"
                referenceNumber={referenceNumber}
                onReferenceNumber={setReferenceNumber}
                document={document}
                onDocument={setDocument}
              />
            ) : null}

            {!chosen && !reference.isError ? (
              <p className="text-sm text-muted-foreground">
                {allTaken
                  ? 'Everything the platform lists is with Medilink. Nothing more to submit.'
                  : 'Choose a type and the form will ask for whatever that one needs.'}
              </p>
            ) : null}

            <div className="space-y-2">
              <Button
                disabled={!chosen || !ready}
                loading={submit.isPending}
                aria-describedby={chosen && missing ? 'submit-missing' : undefined}
                onClick={() => submit.mutate()}
              >
                Submit
              </Button>
              {chosen && missing ? (
                <p id="submit-missing" className="text-sm text-muted-foreground">
                  {missing}
                </p>
              ) : null}
            </div>

            {/* What happened, said where the button was, because a toast is gone in a few seconds
                and the new card may be below the fold on a phone. */}
            <p role="status" className={cn('text-sm', sent ? 'flex items-start gap-2' : 'sr-only')}>
              {sent ? (
                <>
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                  <span>
                    <strong>{sent}</strong> was sent for review. You can follow it under “What you
                    have submitted”.
                  </span>
                </>
              ) : null}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0">
        <h2 className="mb-3 text-base font-semibold">What you have submitted</h2>

        {queue.isPending ? (
          <ListSkeleton rows={2} label="Loading what you have submitted" />
        ) : queue.isError ? (
          <ErrorState
            compact
            error={queue.error}
            onRetry={() => void queue.refetch()}
            retrying={queue.isFetching}
          />
        ) : submissions.length === 0 ? (
          <EmptyState
            compact
            icon={<FileCheck2 />}
            title="Nothing submitted yet"
            description="Anything you submit appears here with its status, and with the reviewer's note if they ask for more."
          />
        ) : (
          <ul className="space-y-3">
            {submissions.map((row) => {
              const step = credentialNextStep(row.status);
              const days =
                row.status === 'VERIFIED' || row.status === 'EXPIRED'
                  ? daysUntilExpiry(row, now)
                  : null;
              const expiry = expiryOf(row);
              const tone = days === null ? undefined : expiryTone(days);
              return (
                <li key={row.id}>
                  <Card className={cn(step.theirMove && 'border-warning/50')}>
                    <CardContent className="space-y-3 pt-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold leading-snug">
                            {nameOf(reference.data?.credentialTypes, row.credentialTypeId)}
                          </h3>
                          <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                            {row.referenceNumber ?? 'Document attached'} · submitted{' '}
                            {formatAgo(row.createdAt)}
                          </p>
                        </div>
                        <StatusBadge status={row.status} />
                      </div>

                      {days !== null && expiry ? (
                        <p
                          className={cn(
                            'flex items-start gap-2 text-sm',
                            tone === 'danger' && 'font-medium text-destructive-text',
                            tone === 'warning' && 'font-medium text-warning',
                          )}
                        >
                          {tone ? (
                            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                          ) : (
                            <Clock
                              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                          <span>
                            {expiry.date} · {expiryPhrase(days)}
                            {expiry.fromDocument
                              ? ''
                              : ' (an estimate: no date was read from the document)'}
                          </span>
                        </p>
                      ) : null}

                      <p className="flex items-start gap-2 text-sm leading-relaxed">
                        {step.theirMove ? (
                          <Send
                            className="mt-0.5 size-4 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                        ) : (
                          <Clock
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span>
                          <span className="font-medium">
                            {step.theirMove ? 'Your move. ' : 'Nothing for you to do. '}
                          </span>
                          {step.says}
                        </span>
                      </p>

                      {row.reviewNotes ? (
                        <Alert
                          variant={row.status === 'REJECTED' ? 'destructive' : 'warning'}
                          role="note"
                        >
                          <AlertDescription>
                            <strong>The reviewer said:</strong> {row.reviewNotes}
                          </AlertDescription>
                        </Alert>
                      ) : null}

                      {row.status === 'MORE_INFO_REQUESTED' ? (
                        <ResupplyForm
                          submissionId={row.id}
                          queueKey={queueKey}
                          method={
                            (reference.data?.credentialTypes ?? []).find(
                              (type) => type.id === row.credentialTypeId,
                            )?.verificationMethod ?? 'document_review'
                          }
                        />
                      ) : null}

                      {row.status === 'REJECTED' || row.status === 'EXPIRED' ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setCredentialTypeId(row.credentialTypeId);
                            setReferenceNumber('');
                            setDocument(null);
                            setSent(null);
                            // The form is above this card, sometimes well above on a phone: take
                            // the person to it and leave them on its first control.
                            typeTrigger.current?.scrollIntoView({ block: 'center' });
                            typeTrigger.current?.focus();
                          }}
                        >
                          {row.status === 'REJECTED'
                            ? 'Submit a corrected one'
                            : 'Submit the current one'}
                        </Button>
                      ) : null}

                      <details className="group rounded-md border px-3 py-2">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                          <History className="size-4 text-muted-foreground" aria-hidden="true" />
                          What has happened to this one
                        </summary>
                        <div className="pb-2 pt-3">
                          <Timeline
                            label={`History of ${nameOf(reference.data?.credentialTypes, row.credentialTypeId)}`}
                            steps={credentialTimeline(row, now, { notes: false })}
                          />
                        </div>
                      </details>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Answering a reviewer who asked for more.
 *
 * On the same submission rather than a new one: the server refuses a second
 * submission of a type while one is waiting on information, because the
 * reviewer would then have two to reconcile. Without this form the request
 * for more was a dead end — the practitioner could read what was wanted and
 * had no way to send it, so a mandatory credential queried once kept them
 * ineligible for good.
 */
function ResupplyForm({
  submissionId,
  queueKey,
  method,
}: {
  submissionId: string;
  queueKey: unknown[];
  method: string;
}) {
  const reference = useReference();
  const rule = evidenceRule(method, reference.data?.verification);
  const [referenceNumber, setReferenceNumber] = useState('');
  const [document, setDocument] = useState<UploadedDocument | null>(null);

  const resupply = useQueueAction<void>({
    queueKey,
    run: () =>
      api.patch(`/api/v1/credentials/${submissionId}`, {
        referenceNumber: referenceToSend(rule, referenceNumber),
        documentObjectKey: document?.objectKey,
      }),
    success: 'Sent back to the reviewer',
  });

  // Anything that answers the question will do — a clearer photograph, or a
  // corrected number — so neither is required on its own. What was already
  // sent stays unless it is replaced.
  //
  // Except a NIN: it is masked as soon as anybody decides on it, so what is
  // stored cannot be reused and the number has to be typed again.
  const answers = rule.isNin
    ? Boolean(referenceNumber.trim())
    : Boolean(document) || Boolean(referenceNumber.trim());
  const ready = answers && !referenceProblem(rule, referenceNumber);
  const reasonId = `resupply-${submissionId}-missing`;

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div>
        <h4 className="text-base font-semibold">Send what the reviewer asked for</h4>
        <p className="mt-0.5 text-sm text-muted-foreground">
          This goes to the same reviewer on the same submission, not as a new one. What you sent
          before stays unless you replace it here.
        </p>
      </div>
      <EvidenceFields
        rule={{ ...rule, documentRequired: false }}
        idPrefix={`resupply-${submissionId}`}
        referenceNumber={referenceNumber}
        onReferenceNumber={setReferenceNumber}
        document={document}
        onDocument={setDocument}
        referenceOptionalNote={rule.isNin ? undefined : 'only if it was wrong'}
      />
      <Button
        disabled={!ready}
        loading={resupply.isPending}
        aria-describedby={ready ? undefined : reasonId}
        onClick={() => resupply.mutate()}
      >
        Send to the reviewer
      </Button>
      {ready ? null : (
        <p id={reasonId} className="text-sm text-muted-foreground">
          {rule.isNin
            ? 'Type the 11-digit number again: it is hidden as soon as it has been checked.'
            : 'Attach a clearer document or give the corrected number to send this.'}
        </p>
      )}
    </div>
  );
}
