import { describe, expect, it } from 'vitest';
import { smsEncoding } from '@/lib/sms-text';
import { generateOtpCode, otpMessageBody, type OtpPurposeKey } from '@/modules/auth/domain/otp';
import { MAX_SEGMENTS, smsProblems } from './sms-hygiene';

/**
 * What a text message must not be, whatever it is about (M16-07, NOT-05). The rules are about the
 * text and not the template that wrote it, so the integration tests can hold every message the
 * platform actually sent to them, and this file can show each rule catching what it is for.
 */

const good = 'Your shift at Gombe Specialist Hospital is confirmed: Wed 15 Oct, 08:00 to 20:00 WAT. Medilink.';

describe('a text that is fine', () => {
  it('has no problems', () => {
    expect(smsProblems(good)).toEqual([]);
  });

  it('may carry a date without a time, an amount, a reference and a one-time code', () => {
    expect(smsProblems('Your licence expires on 2026-11-02. NGN 1,250,000.50 paid (reference PAY-2026-000123).')).toEqual([]);
    expect(smsProblems('482913 is your code to sign in. It expires in 10 minutes. Do not share it.')).toEqual([]);
  });

  it('may say WAT for a night shift that ends the next morning', () => {
    expect(smsProblems('Shift: Wed 15 Oct, 20:00 to Thu 16 Oct, 08:00 WAT. Medilink.')).toEqual([]);
  });
});

describe('the character set', () => {
  it('flags a character that would turn the message into UCS-2, and names it', () => {
    const problems = smsProblems('St Mary’s Hospital has confirmed you…');
    expect(problems.join(' ')).toContain('’');
    expect(problems.join(' ')).toContain('…');
    expect(problems[0]).toMatch(/GSM/);
  });

  it('is content with the accented letters the alphabet has', () => {
    expect(smsProblems('Café Ñ ü')).toEqual([]);
  });
});

describe('the length', () => {
  it(`allows ${MAX_SEGMENTS} segments and not a fourth`, () => {
    expect(smsProblems('a'.repeat(459))).toEqual([]);
    expect(smsProblems('a'.repeat(460)).join(' ')).toMatch(/4 segments/);
  });

  it('counts the escape characters as two', () => {
    expect(smsProblems('a'.repeat(229) + '['.repeat(115))).toEqual([]);
    expect(smsProblems('a'.repeat(231) + '['.repeat(115)).join(' ')).toMatch(/segments/);
  });

  it('refuses a blank text', () => {
    expect(smsProblems('')).toHaveLength(1);
    expect(smsProblems('   \n ')).toHaveLength(1);
  });
});

describe('what it must not carry', () => {
  it('has no email address', () => {
    expect(smsProblems('Contact amina.yusuf@example.com for details.').join(' ')).toMatch(/email/);
  });

  it('has no Nigerian phone number in any of the ways people write one', () => {
    for (const number of [
      '08031234567',
      '0803 123 4567',
      '0803-123-4567',
      '+2348031234567',
      '+234 803 123 4567',
      '2348031234567',
      '+234-803-123-4567',
      '(0803) 123 4567',
    ]) {
      expect(smsProblems(`Call ${number} now.`).join(' '), number).toMatch(/phone/);
    }
  });

  it('has no run of nine digits or more, which is an account number, a NIN or a number', () => {
    expect(smsProblems('Account 0123456789 was added.').join(' ')).toMatch(/digits/);
    expect(smsProblems('NIN 12345678901 verified.').join(' ')).toMatch(/digits/);
    expect(smsProblems('Reference 123456789 sent.').join(' ')).toMatch(/digits/);
    expect(smsProblems('Reference 12345678 sent.')).toEqual([]);
  });

  it('may end an account number in its last four digits', () => {
    expect(smsProblems('A bank account ending 6789 at Access Bank was added.')).toEqual([]);
  });

  it('is not fooled by amounts and dates, which are long but are not numbers to dial', () => {
    expect(smsProblems('NGN 12,345,678.90 on 2026-10-15.')).toEqual([]);
  });
});

describe('the time', () => {
  it('says WAT beside a time', () => {
    expect(smsProblems('Your shift starts at 08:00.').join(' ')).toMatch(/WAT/);
    expect(smsProblems('Your shift is Wed 15 Oct, 08:00 to 20:00. Medilink.').join(' ')).toMatch(/WAT/);
  });

  it('wants each time in its own sentence to carry it, not one somewhere else in the message', () => {
    expect(smsProblems('Shift one is at 08:00. Shift two is at 14:00 WAT.').join(' ')).toMatch(/08:00/);
  });

  it('never says UTC or GMT, which is the bug this was written after', () => {
    expect(smsProblems('Your shift starts at 08:00 UTC WAT.').join(' ')).toMatch(/UTC/);
    expect(smsProblems('Your shift starts 08:00 WAT (07:00 GMT).').join(' ')).toMatch(/GMT/);
  });

  it('never carries a machine timestamp', () => {
    expect(smsProblems('Your shift starts 2026-10-15T07:00:00.000Z WAT.').join(' ')).toMatch(/timestamp/);
    expect(smsProblems('Your shift starts 2026-10-15 07:00:00 WAT.').join(' ')).toMatch(/timestamp/);
  });
});

describe('a template left half filled in', () => {
  it('says so when a value was missing', () => {
    for (const leak of ['undefined', 'null', 'NaN', 'Invalid Date', '[object Object]', '${when}', '{{when}}']) {
      expect(smsProblems(`Your shift at ${leak} is confirmed. Medilink.`).join(' '), leak).toMatch(/not filled in/);
    }
  });

  it('is not alarmed by a word that merely contains one', () => {
    expect(smsProblems('Undefeated Medical Centre says the booking was annulled. Medilink.')).toEqual([]);
  });
});

describe('the one-time code message', () => {
  const purposes: OtpPurposeKey[] = ['PHONE_VERIFICATION', 'EMAIL_VERIFICATION', 'LOGIN', 'PASSWORD_RESET', 'STEP_UP'];

  it('is plain, within one segment and free of the faults above, for every purpose and any code', () => {
    for (const purpose of purposes) {
      for (const code of ['000000', '999999', generateOtpCode()]) {
        const body = otpMessageBody(code, purpose);
        expect(smsProblems(body), body).toEqual([]);
        expect(smsEncoding(body).segments, body).toBe(1);
        expect(body.startsWith(code)).toBe(true);
      }
    }
  });

  it('says how long the code lasts and not to share it', () => {
    for (const purpose of purposes) {
      const body = otpMessageBody('123456', purpose);
      expect(body).toMatch(/expires in \d+ minutes/);
      expect(body).toMatch(/Do not share it/);
    }
  });
});
