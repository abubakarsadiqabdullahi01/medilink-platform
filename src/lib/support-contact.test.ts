import { describe, expect, it } from 'vitest';
import { readSupportContact, telLink, whatsappLink } from './support-contact';

/**
 * UXW-03. The pilot's condition of launch is a staffed phone and WhatsApp line,
 * shown everywhere. Whose number it is is a decision and a staffing fact, so it is
 * configuration: nothing here invents one, and a page shows only what has been set.
 */

describe('the support contact', () => {
  it('is empty when nothing has been configured, rather than a made-up number', () => {
    expect(readSupportContact({})).toEqual({ phone: null, whatsapp: null, email: null, hours: null });
  });

  it('normalises a Nigerian number however it was typed', () => {
    const contact = readSupportContact({ SUPPORT_PHONE: '0803 123 4567', SUPPORT_WHATSAPP: '+234 803 123 4568' });
    expect(contact.phone).toBe('+2348031234567');
    expect(contact.whatsapp).toBe('+2348031234568');
  });

  it('ignores a number that is not one, instead of showing something people cannot dial', () => {
    const contact = readSupportContact({ SUPPORT_PHONE: 'call the office', SUPPORT_WHATSAPP: '12345' });
    expect(contact.phone).toBeNull();
    expect(contact.whatsapp).toBeNull();
  });

  it('keeps an email address and the hours the line is staffed', () => {
    const contact = readSupportContact({ SUPPORT_EMAIL: ' Help@Medilink.example ', SUPPORT_HOURS: 'Mon-Sat, 8am to 8pm WAT' });
    expect(contact.email).toBe('help@medilink.example');
    expect(contact.hours).toBe('Mon-Sat, 8am to 8pm WAT');
  });

  it('ignores an email that is not one', () => {
    expect(readSupportContact({ SUPPORT_EMAIL: 'not an email' }).email).toBeNull();
  });

  it('treats blanks as unset', () => {
    expect(readSupportContact({ SUPPORT_PHONE: '  ', SUPPORT_EMAIL: '', SUPPORT_HOURS: ' ' })).toEqual({
      phone: null,
      whatsapp: null,
      email: null,
      hours: null,
    });
  });
});

describe('links', () => {
  it('dials the number', () => {
    expect(telLink('+2348031234567')).toBe('tel:+2348031234567');
  });

  it('opens WhatsApp on the number, without the plus', () => {
    expect(whatsappLink('+2348031234567')).toBe('https://wa.me/2348031234567');
  });
});
