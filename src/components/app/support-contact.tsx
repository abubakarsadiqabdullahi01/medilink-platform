import { Mail, MessageCircle, Phone } from 'lucide-react';
import {
  hasSupportContact,
  readSupportContact,
  telLink,
  whatsappLink,
} from '@/lib/support-contact';

/**
 * Who to call when somebody is stuck (UXW-03). A server component, because the
 * number is configuration read at request time; it renders nothing at all when
 * none has been set, so a page never shows a number nobody answers.
 */
export function SupportContact({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const contact = readSupportContact();
  if (!hasSupportContact(contact)) return null;

  const link = tone === 'dark' ? 'hover:text-white' : 'hover:text-primary';
  return (
    <div className="space-y-1.5 text-sm">
      {contact.phone ? (
        <p className="flex items-center gap-2">
          <Phone className="size-4 shrink-0" aria-hidden="true" />
          <a href={telLink(contact.phone)} className={`font-medium underline-offset-4 hover:underline ${link}`}>
            {contact.phone}
          </a>
        </p>
      ) : null}
      {contact.whatsapp ? (
        <p className="flex items-center gap-2">
          <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
          <a
            href={whatsappLink(contact.whatsapp)}
            className={`font-medium underline-offset-4 hover:underline ${link}`}
          >
            WhatsApp {contact.whatsapp}
          </a>
        </p>
      ) : null}
      {contact.email ? (
        <p className="flex items-center gap-2">
          <Mail className="size-4 shrink-0" aria-hidden="true" />
          <a href={`mailto:${contact.email}`} className={`font-medium underline-offset-4 hover:underline ${link}`}>
            {contact.email}
          </a>
        </p>
      ) : null}
      {contact.hours ? <p className="opacity-80">{contact.hours}</p> : null}
    </div>
  );
}
