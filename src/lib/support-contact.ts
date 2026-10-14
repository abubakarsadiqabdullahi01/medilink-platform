import { normalizeNigerianPhone } from './phone';

/**
 * How to reach a person at Medilink (UXW-03).
 *
 * The pilot's condition of launch is a staffed phone and WhatsApp line, shown
 * everywhere somebody might be stuck. Whose number that is, and when it is
 * answered, is a staffing fact and not something to write into source: it is read
 * from the environment, and a page shows only what has been set. Nothing here
 * invents a number, and a number that is not one is ignored rather than shown.
 */
export interface SupportContact {
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  /** When the line is staffed, in words: "Monday to Saturday, 8am to 8pm WAT". */
  hours: string | null;
}

function phoneOf(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return normalizeNigerianPhone(raw.trim());
  } catch {
    return null;
  }
}

function emailOf(raw: string | undefined): string | null {
  const value = raw?.trim().toLowerCase();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export function readSupportContact(
  env: Record<string, string | undefined> = process.env,
): SupportContact {
  return {
    phone: phoneOf(env.SUPPORT_PHONE),
    whatsapp: phoneOf(env.SUPPORT_WHATSAPP),
    email: emailOf(env.SUPPORT_EMAIL),
    hours: env.SUPPORT_HOURS?.trim() || null,
  };
}

export const telLink = (phone: string) => `tel:${phone}`;

/** WhatsApp wants the number as digits with the country code and no plus. */
export const whatsappLink = (phone: string) => `https://wa.me/${phone.replace(/^\+/, '')}`;

/** Whether there is anything to show. */
export function hasSupportContact(contact: SupportContact): boolean {
  return Boolean(contact.phone || contact.whatsapp || contact.email);
}
