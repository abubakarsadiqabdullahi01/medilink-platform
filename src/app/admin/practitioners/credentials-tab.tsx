'use client';

import { FileCheck2 } from 'lucide-react';
import { api } from '@/lib/ui/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/app/status-badge';
import { Detail, DetailGrid, EmptyState } from '@/components/app/page-shell';
import { DocumentDialog } from '@/components/app/document-dialog';
import { ErrorState, ListSkeleton } from '@/components/app/states';
import { expiryOf, formatAgo, formatDate } from '@/components/app/format';
import { CredentialDecision } from '@/app/admin/credentials/credential-decision';
import { usePractitionerSubmissions } from './submissions';

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
 * The decision itself — a reason, the expiry on the document, and three outcomes that
 * each ask before they act — is the same component the queue uses, so the two never drift.
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
  const queue = usePractitionerSubmissions(userId);

  if (queue.isPending) return <ListSkeleton rows={2} label="Loading their credentials" />;

  if (queue.isError) {
    return (
      <ErrorState
        error={queue.error}
        onRetry={() => void queue.refetch()}
        retrying={queue.isFetching}
        compact
      />
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
      {queue.data.map((row) => (
        <Card key={row.id}>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0 pb-4">
            <div className="min-w-0">
              <p className="font-medium">{row.credentialTypeName}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
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
              <p className="text-sm text-muted-foreground">
                Nothing was uploaded with this one — the reference number is all there is to check.
              </p>
            )}

            {row.reviewNotes ? (
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                <p className="text-sm font-medium text-muted-foreground">Last note</p>
                <p className="mt-1 [overflow-wrap:anywhere]">{row.reviewNotes}</p>
              </div>
            ) : null}

            <div className="border-t pt-4 empty:hidden">
              <CredentialDecision
                submission={row}
                practitionerName={practitionerName}
                userId={userId}
                confirmRecord={{
                  onClick: onConfirm,
                  label: 'Confirm in Identity and registration',
                }}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
