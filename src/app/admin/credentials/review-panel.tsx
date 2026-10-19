'use client';

import Link from 'next/link';
import { UserRound } from 'lucide-react';
import { api } from '@/lib/ui/api';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { DocumentDialog } from '@/components/app/document-dialog';
import { Detail, DetailGrid } from '@/components/app/page-shell';
import { QueueAge, type AgeThresholds } from '@/components/app/queue-age';
import { StatusBadge } from '@/components/app/status-badge';
import { expiryOf, formatAgo, formatDate } from '@/components/app/format';
import { CredentialDecision } from './credential-decision';
import { canDecide, type CredentialStatus } from './credential-status';

/** One row of the credentials queue, as the API lists it. */
export interface QueueSubmission {
  id: string;
  userId: string;
  credentialTypeId: string;
  status: CredentialStatus;
  referenceNumber: string | null;
  expiresAt: string | null;
  /** The date printed on the document, as read by the reviewer. */
  documentExpiresOn: string | null;
  createdAt: string;
  reviewNotes: string | null;
  practitionerName: string;
  practitionerPhone: string;
  practitionerPhotoUrl: string | null;
  credentialTypeName: string;
  documentObjectKey: string | null;
  /** How it is checked: a NIN or licence number is confirmed from the practitioner's page. */
  verificationMethod: string;
  /** Whether it has an expiry date to read off the document. */
  credentialTypeExpires: boolean;
}

export function PractitionerFace({
  row,
  size = 'md',
}: {
  row: QueueSubmission;
  size?: 'md' | 'lg';
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted ${
        size === 'lg' ? 'size-14' : 'size-11'
      }`}
    >
      {row.practitionerPhotoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.practitionerPhotoUrl} alt="" className="size-full object-cover" />
      ) : (
        <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * Everything a reviewer needs to decide one submission, in one place, without leaving the queue.
 *
 * The queue is a list of rows to scan; deciding is the opposite — slow, with the document open and
 * a reason to write. So the row's "Review" opens this panel: who it is, what they sent, the document
 * a click away, and the three outcomes below, each of which asks before it acts. On a phone it is the
 * whole screen. Closing it leaves the queue exactly where it was.
 */
export function ReviewPanel({
  row,
  thresholds,
  onClose,
}: {
  row: QueueSubmission | null;
  thresholds: AgeThresholds;
  onClose: () => void;
}) {
  return (
    <Sheet open={row !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {row ? (
          <>
            <SheetHeader className="pr-10 text-left">
              <SheetTitle>Review this submission</SheetTitle>
              <SheetDescription>
                {row.credentialTypeName} · {row.practitionerName}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-5">
              <div className="flex items-center gap-3">
                <PractitionerFace row={row} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug [overflow-wrap:anywhere]">
                    {row.practitionerName}
                  </p>
                  <p className="font-mono text-sm text-muted-foreground">{row.practitionerPhone}</p>
                  <Link
                    href={`/admin/practitioners?user=${row.userId}`}
                    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open their whole record
                  </Link>
                </div>
                <StatusBadge status={row.status} />
              </div>

              {row.status === 'PENDING' ? (
                <QueueAge since={row.createdAt} label="Waiting" thresholds={thresholds} />
              ) : null}

              <DetailGrid>
                <Detail label="Credential" className="col-span-full">
                  <span className="whitespace-normal">{row.credentialTypeName}</span>
                </Detail>
                <Detail label="Reference">{row.referenceNumber ?? 'None given'}</Detail>
                <Detail label="Document">
                  {row.documentObjectKey ? 'Attached' : 'None attached'}
                </Detail>
                <Detail label="Expires">{expiryOf(row)?.text ?? '—'}</Detail>
                <Detail label="Submitted" className="col-span-full">
                  <span className="whitespace-normal">
                    {formatDate(row.createdAt)} · {formatAgo(row.createdAt)}
                  </span>
                </Detail>
              </DetailGrid>

              {row.documentObjectKey ? (
                <DocumentDialog
                  title={row.credentialTypeName}
                  description={`${row.practitionerName} · submitted ${formatAgo(row.createdAt)}`}
                  fetchUrl={() =>
                    api.post<{ url: string }>(`/api/v1/credentials/${row.id}/document-url`, {
                      scopeType: 'PLATFORM',
                    })
                  }
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing was uploaded with this one — the reference number is all there is to
                  check.
                </p>
              )}

              {row.reviewNotes ? (
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <p className="text-sm font-medium text-muted-foreground">Last note</p>
                  <p className="mt-1 [overflow-wrap:anywhere]">{row.reviewNotes}</p>
                </div>
              ) : null}

              {canDecide(row.status) || row.status === 'MORE_INFO_REQUESTED' ? (
                <div className="border-t pt-5">
                  <CredentialDecision
                    submission={row}
                    practitionerName={row.practitionerName}
                    userId={row.userId}
                    confirmRecord={{
                      href: `/admin/practitioners?user=${row.userId}`,
                      label: 'Review and confirm',
                    }}
                    onDecided={onClose}
                  />
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
