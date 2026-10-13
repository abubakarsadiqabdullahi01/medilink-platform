import type { Metadata } from 'next';
import { PublicPage } from '@/components/app/public-page';
import { currentPublicAgreements } from '@/modules/audit-compliance/application/consent';

export const metadata: Metadata = { title: 'Privacy notice — Medilink' };
// Read from the database at request time: what is in force changes without a deploy.
export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  const notice = (await currentPublicAgreements()).find((row) => row.kind === 'PRIVACY_NOTICE');

  return (
    <PublicPage title="Privacy notice">
      {notice ? (
        <article>
          <p className="text-sm text-muted-foreground">
            {notice.title} · version {notice.identifier} · in force from{' '}
            {notice.effectiveFrom.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <p className="mt-6 whitespace-pre-wrap leading-relaxed">{notice.body}</p>
        </article>
      ) : (
        <p className="leading-relaxed">
          The privacy notice has not been published yet. It will be here, and you will be asked to
          accept it when you create an account.
        </p>
      )}
    </PublicPage>
  );
}
