'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileCheck2, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '@/lib/ui/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState, QueueSkeleton } from '@/components/app/page-shell';
import { DocumentDialog } from '@/components/app/document-dialog';
import { expiryOf, formatAgo, formatDate } from '@/components/app/format';
import { isRecordChecked, usePractitionerSubmissions } from './submissions';

/**
 * One practitioner's credentials, reviewed where the rest of their record is.
 *
 * The flat queue answers "what is waiting?", which is the right question at
 * the start of a morning. It is the wrong one once you are looking at a
 * person: their four submissions sat as four separate cards, each repeating
 * their name and face, and an officer deciding whether somebody can work had
 * to hold the set in their head. Here they are the set, next to the identity
 * and registration that gate the same outcome.
 *
 * The list endpoint already narrowed to one practitioner at PLATFORM scope —
 * "an optional narrowing to a single practitioner for a reviewer's lookup" —
 * so this needed no new API.
 */

export function CredentialsTab({
  userId,
  practitionerName,
  onConfirm,
}: {
  userId: string;
  practitionerName: string;
  /** Takes the officer to where a NIN or licence number is confirmed. */
  onConfirm: () => void;
}) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  // The expiry date the reviewer reads off a document, per submission.
  const [printed, setPrinted] = useState<Record<string, string>>({});

  const queue = usePractitionerSubmissions(userId);

  const review = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: 'approve' | 'reject' | 'request_info';
    }) =>
      api.post(`/api/v1/credentials/${id}/review`, {
        decision,
        reviewNotes: notes[id]?.trim() || undefined,
        printedExpiryDate: decision === 'approve' ? printed[id] || undefined : undefined,
      }),
    onSuccess: (_result, { decision }) => {
      toast.success(
        decision === 'approve'
          ? 'Credential verified'
          : decision === 'reject'
            ? 'Credential rejected'
            : 'More information requested',
      );
      void queryClient.invalidateQueries({ queryKey: ['practitioner-credentials', userId] });
      // Verifying the last mandatory one can make somebody eligible, so the
      // card that says whether they can work has to be re-asked.
      void queryClient.invalidateQueries({ queryKey: ['eligibility-of', userId] });
      void queryClient.invalidateQueries({ queryKey: ['credentials'] });
      void queryClient.invalidateQueries({ queryKey: ['tile'] });
    },
    onError: (error) => toast.error('Could not record that', { description: errorMessage(error) }),
  });

  if (queue.isPending) return <QueueSkeleton rows={2} />;

  if (queue.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertDescription>Their credentials could not be loaded.</AlertDescription>
      </Alert>
    );
  }

  if (queue.data.length === 0) {
    return (
      <EmptyState
        icon={<FileCheck2 />}
        title="Nothing submitted"
        description="They stay ineligible until every credential their profession requires has been submitted and verified."
      />
    );
  }

  return (
    <div className="space-y-4">
      {queue.data.map((row) => {
        const note = notes[row.id]?.trim() ?? '';
        const open = row.status === 'PENDING' || row.status === 'INFO_REQUESTED';

        return (
          <Card key={row.id}>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
              <div className="min-w-0">
                <p className="font-medium">{row.credentialTypeName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Submitted {formatAgo(row.createdAt)}
                </p>
              </div>
              <StatusBadge status={row.status} />
            </CardHeader>

            <CardContent className="space-y-4">
              <DetailGrid>
                <Detail label="Reference">{row.referenceNumber ?? 'None given'}</Detail>
                <Detail label="Document">
                  {row.documentObjectKey ? 'Attached' : 'None attached'}
                </Detail>
                <Detail label="Expires">{expiryOf(row)?.text ?? '—'}</Detail>
                <Detail label="Submitted">{formatDate(row.createdAt)}</Detail>
              </DetailGrid>

              {row.documentObjectKey ? (
                <DocumentDialog
                  title={row.credentialTypeName}
                  description={`${practitionerName} · submitted ${formatAgo(row.createdAt)}`}
                  fetchUrl={() =>
                    api.post<{ url: string }>(`/api/v1/credentials/${row.id}/document-url`, {
                      scopeType: 'PLATFORM',
                    })
                  }
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nothing was uploaded with this one — the reference number is all there is to
                  check.
                </p>
              )}

              {row.reviewNotes ? (
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Last note
                  </p>
                  <p className="mt-1">{row.reviewNotes}</p>
                </div>
              ) : null}

              {open ? (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label htmlFor={`note-${row.id}`}>
                      Reason{' '}
                      <span className="font-normal text-muted-foreground">
                        — required to reject or to ask for more
                      </span>
                    </Label>
                    <Textarea
                      id={`note-${row.id}`}
                      rows={2}
                      placeholder="What is wrong, or what is missing."
                      value={notes[row.id] ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                    />
                  </div>

                  {row.credentialTypeExpires && !isRecordChecked(row) ? (
                    <div className="space-y-2">
                      <Label htmlFor={`printed-${row.id}`}>
                        Expiry date on the document{' '}
                        <span className="font-normal text-muted-foreground">
                          — read it off the document. If none is printed, leave it empty and an
                          estimate is used.
                        </span>
                      </Label>
                      <Input
                        id={`printed-${row.id}`}
                        type="date"
                        className="max-w-xs"
                        value={printed[row.id] ?? ''}
                        onChange={(event) =>
                          setPrinted((current) => ({ ...current, [row.id]: event.target.value }))
                        }
                      />
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    {isRecordChecked(row) ? (
                      // Approving a NIN or a licence has to *record* the identity or
                      // registration as well, which is done where the rest of that
                      // record is — not by a bare "verify" that would leave them blocked.
                      <Button variant="success" onClick={onConfirm}>
                        Confirm in Identity and registration
                      </Button>
                    ) : (
                      <Button
                        variant="success"
                        loading={review.isPending && review.variables?.id === row.id}
                        onClick={() => review.mutate({ id: row.id, decision: 'approve' })}
                      >
                        Verify
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      disabled={!note || review.isPending}
                      onClick={() => review.mutate({ id: row.id, decision: 'request_info' })}
                    >
                      Ask for more
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={!note || review.isPending}
                      onClick={() => review.mutate({ id: row.id, decision: 'reject' })}
                    >
                      Reject
                    </Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
