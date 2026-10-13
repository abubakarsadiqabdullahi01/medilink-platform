'use client';

import { useState, type ReactNode } from 'react';
import { FileCheck2, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { nameOf, useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/app/status-badge';
import { type UploadedDocument } from '@/components/app/document-upload';
import { EmptyState, QueueSkeleton } from '@/components/app/page-shell';
import {
  EvidenceFields,
  evidenceRule,
  isComplete,
  referenceProblem,
  referenceToSend,
} from './evidence-fields';
import { formatAgo, formatDate } from '@/components/app/format';

interface Submission {
  id: string;
  credentialTypeId: string;
  status: string;
  referenceNumber: string | null;
  expiresAt: string | null;
  reviewNotes: string | null;
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
 * The reviewer's note is shown in full on a rejection or a request for more.
 * It is the only thing that tells somebody what to fix, and hiding it behind
 * "contact support" loses the practitioner rather than the document.
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
  const queueKey = ['my-credentials'];
  const queue = useQueue<Submission>(
    queueKey,
    '/api/v1/credentials?scopeType=SELF',
    (body) => (body as { submissions?: Submission[] }).submissions ?? [],
  );

  const [credentialTypeId, setCredentialTypeId] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [document, setDocument] = useState<UploadedDocument | null>(null);

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
    onDone: resetForm,
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

  return (
    // The form on the left and what has become of earlier submissions on the
    // right, so a wide screen shows both without scrolling past one to reach
    // the other; on a phone they stack, form first.
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-6">
        {leading}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Submit a credential</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={credentialTypeId}
                onValueChange={(value) => {
                  setCredentialTypeId(value);
                  // What the form asks for changes with the type, so anything
                  // already entered no longer belongs to the question.
                  setReferenceNumber('');
                  setDocument(null);
                }}
              >
                <SelectTrigger>
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
            </div>

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

            {!chosen ? (
              <p className="text-sm text-muted-foreground">
                {allTaken
                  ? 'Everything the platform lists is with Medilink. Nothing more to submit.'
                  : 'Choose a type and the form will ask for whatever that one needs. Ones already submitted are greyed out.'}
              </p>
            ) : null}

            <Button
              disabled={!chosen || !ready}
              loading={submit.isPending}
              onClick={() => submit.mutate()}
            >
              Submit
            </Button>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium">What you have submitted</h2>

        {queue.isPending ? (
          <QueueSkeleton rows={2} />
        ) : queue.isError ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>These could not be loaded.</AlertDescription>
          </Alert>
        ) : queue.data.length === 0 ? (
          <EmptyState
            compact
            icon={<FileCheck2 />}
            title="Nothing submitted yet"
            description="Anything you submit appears here with its status, and with the reviewer's note if they ask for more."
          />
        ) : (
          <div className="space-y-3">
            {queue.data.map((row) => (
              <Card key={row.id}>
                <CardContent className="space-y-2 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {nameOf(reference.data?.credentialTypes, row.credentialTypeId)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.referenceNumber ?? 'Document attached'} · submitted{' '}
                        {formatAgo(row.createdAt)}
                        {row.expiresAt ? ` · expires ${formatDate(row.expiresAt)}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>

                  {row.reviewNotes ? (
                    <Alert
                      variant={row.status === 'REJECTED' ? 'destructive' : 'warning'}
                      className="mt-2"
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

                  {row.status === 'REJECTED' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <p className="text-xs text-muted-foreground">
                        A rejected credential is closed. Submit a corrected one to be reviewed
                        again.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCredentialTypeId(row.credentialTypeId);
                          setReferenceNumber('');
                          setDocument(null);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        Submit again
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
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

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Send what the reviewer asked for</p>
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
        size="sm"
        disabled={!ready}
        loading={resupply.isPending}
        onClick={() => resupply.mutate()}
      >
        Send to the reviewer
      </Button>
    </div>
  );
}
