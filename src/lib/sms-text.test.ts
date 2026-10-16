import { describe, expect, it } from 'vitest';
import { smsEncoding, toSmsText } from './sms-text';

/**
 * What a text costs is decided by its characters, not only by how many there are. One character
 * outside the GSM 03.38 alphabet turns the whole message into UCS-2, where a segment holds 70
 * characters and not 160 (and 67 and not 153 once it is more than one). A smart apostrophe in a
 * hospital's name, or an ellipsis a template adds, more than doubles what a message costs.
 */

const text = (length: number, char = 'a') => char.repeat(length);

describe('the encoding of a text', () => {
  it('is GSM-7 for plain English, digits and the punctuation a template uses', () => {
    const result = smsEncoding('Your shift at Gombe Specialist Hospital is confirmed: Wed 15 Oct, 08:00 to 20:00 WAT. NGN 5,000 (ref A-1/2). Medilink.');
    expect(result.encoding).toBe('GSM-7');
    expect(result.unsupported).toEqual([]);
  });

  it('allows the accented letters the alphabet has, and not the ones Nigerian names need', () => {
    expect(smsEncoding('Café, ñ, ü, ö, ä, è, ù, ì, ò').encoding).toBe('GSM-7');
    // Yoruba and Igbo letters with a dot or a tone mark are not in the alphabet.
    expect(smsEncoding('Ọlá').encoding).toBe('UCS-2');
    expect(smsEncoding('Ṣọla').unsupported).toEqual(['Ṣ', 'ọ']);
    expect(smsEncoding('Chukwuẹmeka').encoding).toBe('UCS-2');
  });

  it('is UCS-2 for the characters phones type on their own: curly quotes, dashes, ellipsis, the naira sign', () => {
    for (const char of ['’', '‘', '“', '”', '–', '—', '…', '₦', '\u00a0']) {
      expect(smsEncoding(`St Mary${char}s`).encoding, JSON.stringify(char)).toBe('UCS-2');
    }
    expect(smsEncoding('St Mary’s Hospital').unsupported).toEqual(['’']);
  });

  it('names each character that forced it, once', () => {
    expect(smsEncoding('a…b…c’').unsupported).toEqual(['…', '’']);
  });
});

describe('the segments of a text', () => {
  it('is one up to 160 characters in GSM-7 and then 153 to a segment', () => {
    expect(smsEncoding(text(160)).segments).toBe(1);
    expect(smsEncoding(text(161)).segments).toBe(2);
    expect(smsEncoding(text(306)).segments).toBe(2);
    expect(smsEncoding(text(307)).segments).toBe(3);
    expect(smsEncoding(text(459)).segments).toBe(3);
    expect(smsEncoding(text(460)).segments).toBe(4);
  });

  it('is one up to 70 characters in UCS-2 and then 67 to a segment', () => {
    expect(smsEncoding(text(69) + '…').segments).toBe(1);
    expect(smsEncoding(text(70) + '…').segments).toBe(2);
    expect(smsEncoding(text(133) + '…').segments).toBe(2);
    expect(smsEncoding(text(134) + '…').segments).toBe(3);
  });

  it('counts the characters the alphabet reaches by an escape as two', () => {
    // [ ] { } \\ ^ ~ | and the euro sign each take two places in a GSM-7 segment.
    for (const char of ['[', ']', '{', '}', '\\', '^', '~', '|', '€']) {
      const result = smsEncoding(char);
      expect(result.encoding, char).toBe('GSM-7');
      expect(result.units, char).toBe(2);
    }
    expect(smsEncoding(text(159) + '[').segments).toBe(2);
    expect(smsEncoding(text(158) + '[').segments).toBe(1);
  });

  it('counts a character outside the basic plane as two UCS-2 places', () => {
    const emoji = '\u{1F600}';
    expect(smsEncoding(emoji).units).toBe(2);
    expect(smsEncoding(text(68) + emoji).segments).toBe(1);
    expect(smsEncoding(text(69) + emoji).segments).toBe(2);
  });

  it('is what one character costs when it turns a long text into UCS-2', () => {
    const body = text(300);
    expect(smsEncoding(body).segments).toBe(2);
    expect(smsEncoding(body + '…').segments).toBe(5);
  });

  it('has no segments when there is nothing to send', () => {
    expect(smsEncoding('')).toMatchObject({ units: 0, segments: 0, encoding: 'GSM-7' });
  });
});

describe('making a text fit the alphabet', () => {
  it('turns the punctuation a phone keyboard types into the plain kind, so a name does not double the price', () => {
    expect(toSmsText('St Mary’s ‘Annex’ “Ward” – A — B…')).toBe('St Mary\'s \'Annex\' "Ward" - A - B...');
    expect(smsEncoding(toSmsText('St Mary’s Hospital')).encoding).toBe('GSM-7');
  });

  it('writes the naira sign as NGN, with the space between it and the figure', () => {
    expect(toSmsText('₦5,000')).toBe('NGN 5,000');
    expect(toSmsText('₦ 5,000')).toBe('NGN 5,000');
    expect(toSmsText('Paid ₦1,500 and ₦20')).toBe('Paid NGN 1,500 and NGN 20');
  });

  it('turns a non-breaking space into a space', () => {
    expect(toSmsText('Gombe\u00a0Specialist\u00a0Hospital')).toBe('Gombe Specialist Hospital');
  });

  it('keeps a letter that has its accent typed separately inside the alphabet', () => {
    const decomposed = 'Cafe\u0301';
    expect(smsEncoding(decomposed).encoding).toBe('UCS-2');
    expect(toSmsText(decomposed)).toBe('Caf\u00e9');
    expect(smsEncoding(toSmsText(decomposed)).encoding).toBe('GSM-7');
  });

  it('leaves a person\'s own letters alone: Ọlá is not Ola', () => {
    expect(toSmsText('Ọlá Ṣọla')).toBe('Ọlá Ṣọla');
  });

  it('changes nothing in a text that was already plain, and is the same however often it is applied', () => {
    const plain = 'Your shift at Gombe Specialist Hospital is confirmed: Wed 15 Oct, 08:00 to 20:00 WAT. NGN 5,000. Medilink.';
    expect(toSmsText(plain)).toBe(plain);
    const messy = 'St Mary’s… ₦5,000';
    expect(toSmsText(toSmsText(messy))).toBe(toSmsText(messy));
  });
});
