'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/ui/api';
import type { CredentialStatus } from '@/app/admin/credentials/credential-status';

/**
 * One practitioner's credential submissions, as an officer sees them.
 *
 * Shared by the evidence review and the credentials tab so they read one cache
 * entry: confirming an identity in one has to update the other without a second
 * request, and two queries under one key with different shapes is the bug
 * lib/ui/queue.ts warns about.
 */
export interface Submission {
  id: string;
  status: CredentialStatus;
  referenceNumber: string | null;
  expiresAt: string | null;
  /** The date printed on the document, as read by the reviewer. */
  documentExpiresOn: string | null;
  createdAt: string;
  reviewNotes: string | null;
  credentialTypeName: string;
  documentObjectKey: string | null;
  /** How it is checked; see the server's credentials domain. */
  verificationMethod: string;
  /** Whether it has an expiry date to read off the document. */
  credentialTypeExpires: boolean;
}

/**
 * The credentials checked against a record by number, rather than read as a
 * document. Approving one has to *record* an identity or registration, so it
 * goes through "confirm", not "verify". Kept in step with
 * `isReferenceChecked` in the credentials domain.
 */
export const RECORD_CHECKED = ['nimc_verification', 'mdcn_status_check'];

export function isRecordChecked(submission: Pick<Submission, 'verificationMethod'>): boolean {
  return RECORD_CHECKED.includes(submission.verificationMethod);
}

export function usePractitionerSubmissions(userId: string) {
  return useQuery({
    queryKey: ['practitioner-credentials', userId],
    queryFn: async () => {
      const body = await api.get<{ submissions?: Submission[] }>(
        `/api/v1/credentials?scopeType=PLATFORM&scopeId=${userId}`,
      );
      return body.submissions ?? [];
    },
    retry: false,
  });
}
