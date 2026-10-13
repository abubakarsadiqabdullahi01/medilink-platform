import type { Metadata } from 'next';
import { PublicPage } from '@/components/app/public-page';
import { SupportContact } from '@/components/app/support-contact';
import { hasSupportContact, readSupportContact } from '@/lib/support-contact';

export const metadata: Metadata = { title: 'Contact — Medilink' };
export const dynamic = 'force-dynamic';

export default function ContactPage() {
  const configured = hasSupportContact(readSupportContact());

  return (
    <PublicPage title="Contact">
      {configured ? (
        <section>
          <p className="mb-5 leading-relaxed">
            If you are stuck, a person will help. Call, or message on WhatsApp.
          </p>
          <SupportContact />
        </section>
      ) : (
        <p className="leading-relaxed">
          No contact line has been set up for this site yet. If you were given a number or an
          address by the people running this pilot, use that.
        </p>
      )}
    </PublicPage>
  );
}
