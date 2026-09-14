'use client';

import { useState } from 'react';
import { FileCheck2, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { useQueue, useQueueAction } from '@/lib/ui/queue';
import { nameOf, useReference } from '@/lib/ui/reference';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StatusBadge } from '@/components/app/status-badge';
import { DocumentUpload, type UploadedDocument } from '@/components/app/document-upload';
import { EmptyState, PageHeader, QueueSkeleton } from '@/components/app/page-shell';
import { formatAgo, formatDate } from '@/components/app/format';

interface Submission {
  id: string;
  credentialTypeId: string;
  status: string;
  reference: string | null;
  expiresAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

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
export default function CredentialsPage() {
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

  const chosen = (reference.data?.credentialTypes ?? []).find(
    (row) => row.id === credentialTypeId,
  );
  const needsDocument = chosen?.verificationMethod === 'document_review';
  const needsReference = Boolean(chosen) && !needsDocument;

  const submit = useQueueAction<void>({
    queueKey,
    run: () =>
      api.post('/api/v1/credentials', {
        credentialTypeId,
        referenceNumber: referenceNumber.trim() || undefined,
        documentObjectKey: document?.objectKey,
      }),
    success: 'Submitted for review',
  });

  const ready = needsDocument ? Boolean(document) : Boolean(referenceNumber.trim());

  return (
    <>
      <PageHeader
        title="Credentials"
        description="Every mandatory credential for your profession has to be verified before you can be offered work. A reviewer checks each one by hand."
      />

      <Card className="mb-8">
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
                {(reference.data?.credentialTypes ?? []).map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsReference ? (
            <div className="space-y-1.5">
              <Label htmlFor="reference">Reference or licence number</Label>
              <Input
                id="reference"
                value={referenceNumber}
                onChange={(event) => setReferenceNumber(event.target.value)}
                placeholder="MDCN/12345"
              />
              <p className="text-xs text-muted-foreground">
                This one is checked against the regulator&apos;s register, so the number is enough.
              </p>
            </div>
          ) : null}

          {needsDocument ? (
            <div className="space-y-1.5">
              <Label>Document</Label>
              <DocumentUpload
                endpoint="/api/v1/credentials/document-upload-url"
                value={document}
                onUploaded={setDocument}
                label="Attach your certificate"
                hint="A PDF or a clear photograph, up to 10 MB. It goes straight to storage."
              />
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="reference-optional">
                  Reference number{' '}
                  <span className="font-normal text-muted-foreground">— optional</span>
                </Label>
                <Input
                  id="reference-optional"
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                  placeholder="If the document has one"
                />
              </div>
            </div>
          ) : null}

          {!chosen ? (
            <p className="text-sm text-muted-foreground">
              Choose a type and the form will ask for whatever that one needs.
            </p>
          ) : null}

          <Button disabled={!chosen || !ready} loading={submit.isPending} onClick={() => submit.mutate()}>
            Submit
          </Button>
        </CardContent>
      </Card>

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
          icon={<FileCheck2 />}
          title="Nothing submitted yet"
          description="You stay ineligible for work until the mandatory ones are verified."
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
                      {row.reference ?? 'Document attached'} · submitted {formatAgo(row.createdAt)}
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
