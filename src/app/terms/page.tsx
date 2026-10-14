import type { Metadata } from 'next';
import { PublicPage } from '@/components/app/public-page';
import { currentPublicAgreements } from '@/modules/audit-compliance/application/consent';

export const metadata: Metadata = { title: 'Terms — Medilink' };
export const dynamic = 'force-dynamic';

const SECTIONS: { kind: string; heading: string; missing: string }[] = [
  {
    kind: 'PRACTITIONER_ENGAGEMENT',
    heading: 'For practitioners',
    missing: 'The terms for practitioners have not been published yet.',
  },
  {
    kind: 'FACILITY_TERMS',
    heading: 'For hospitals and clinics',
    missing: 'The terms for hospitals and clinics have not been published yet.',
  },
];

export default async function TermsPage() {
  const documents = await currentPublicAgreements();

  return (
    <PublicPage title="Terms">
      {SECTIONS.map((section) => {
        const document = documents.find((row) => row.kind === section.kind);
        return (
          <section key={section.kind} aria-labelledby={`terms-${section.kind}`}>
            <h2 id={`terms-${section.kind}`} className="text-xl font-semibold">
              {section.heading}
            </h2>
            {document ? (
              <>
                <p className="mt-1 text-sm text-muted-foreground">
                  {document.title} · version {document.identifier} · in force from{' '}
                  {document.effectiveFrom.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <p className="mt-4 whitespace-pre-wrap leading-relaxed">{document.body}</p>
              </>
            ) : (
              <p className="mt-3 leading-relaxed">{section.missing}</p>
            )}
          </section>
        );
      })}
    </PublicPage>
  );
}
