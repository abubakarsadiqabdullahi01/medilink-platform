'use client';

import Link from 'next/link';
import { ArrowRight, OctagonAlert } from 'lucide-react';
import { type CredentialSubmission } from '@/lib/ui/practitioner';
import { nameOf, useReference } from '@/lib/ui/reference';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * An officer refused something the practitioner must supply.
 *
 * Shown wherever they look — the overview, the profile — and not only on the
 * Credentials tab, because a rejection that is visible only to somebody who
 * goes looking for it is, in effect, silent: the practitioner saw "waiting for
 * approval" and waited. It says which document, says why in the reviewer's own
 * words, and says the rule: replace it, then submit again. Nothing is approved
 * on the strength of the document that was refused.
 */
export function ReturnedNotice({
  rejected,
  className,
}: {
  rejected: CredentialSubmission[];
  className?: string;
}) {
  const reference = useReference();
  if (rejected.length === 0) return null;

  return (
    <Card className={cn('border-destructive/40 bg-destructive/5', className)}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start gap-3">
          <OctagonAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">
              {rejected.length === 1 ? 'A document was refused' : `${rejected.length} documents were refused`}
              : your application was sent back
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              An officer cannot approve you on a document they refused. Submit a corrected one, then
              send your application for approval again.
            </p>
          </div>
        </div>

        <ul className="space-y-2">
          {rejected.map((row) => (
            <li key={row.id} className="rounded-md border border-destructive/30 bg-background p-3 text-sm">
              <p className="font-medium">{nameOf(reference.data?.credentialTypes, row.credentialTypeId)}</p>
              <p className="mt-0.5 text-muted-foreground">
                {row.reviewNotes ? (
                  <>
                    <strong className="font-medium text-foreground">The reviewer said:</strong> {row.reviewNotes}
                  </>
                ) : (
                  'The reviewer gave no note. Check the document is clear, complete and in date.'
                )}
              </p>
            </li>
          ))}
        </ul>

        <Link href="/practitioner/profile?tab=credentials" className={buttonVariants()}>
          Fix and resubmit
          <ArrowRight />
        </Link>
      </CardContent>
    </Card>
  );
}
