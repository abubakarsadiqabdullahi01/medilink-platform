import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { currentPublicAgreements, publishAgreement } from '@/modules/audit-compliance/application/consent';
import { startRegistration } from '@/modules/auth/application/registration';
import { clearCookies } from './support/cookie-jar';
import { startSmsCapture, stopSmsCapture } from './support/sms-capture';
import { createUser } from './support/fixtures';

/**
 * UXW-04 and AUD-03. The terms and the privacy notice were shown only inside a
 * console, after sign-in; the sign-up form linked to neither and recorded no
 * acceptance. What they say is counsel's; whether they are shown where data is
 * collected, and whether agreeing is recorded, is not.
 */

beforeEach(() => {
  clearCookies();
  startSmsCapture();
});
afterEach(stopSmsCapture);

let counter = 0;
async function publish(
  kind: 'PRACTITIONER_ENGAGEMENT' | 'FACILITY_TERMS' | 'PRIVACY_NOTICE',
  options: { title?: string; effectiveFrom?: Date } = {},
) {
  const officer = await createUser({ fullName: 'Compliance Officer' });
  counter += 1;
  return publishAgreement({
    kind,
    identifier: `${kind.toLowerCase()}-${counter}`,
    title: options.title ?? `Document ${counter}`,
    body: 'The text of the agreement, long enough to be one. '.repeat(3),
    effectiveFrom: options.effectiveFrom ?? new Date(Date.now() - 60_000),
    actorId: officer.id,
  });
}

describe('what anybody can read without signing in', () => {
  it('is whatever is in force, one document of each kind', async () => {
    await publish('PRIVACY_NOTICE', { title: 'Privacy notice v1' });
    await publish('PRIVACY_NOTICE', { title: 'Privacy notice v2' });
    await publish('PRACTITIONER_ENGAGEMENT', { title: 'Engagement terms' });

    const documents = await currentPublicAgreements();

    expect(documents.map((row) => row.title).sort()).toEqual(['Engagement terms', 'Privacy notice v2']);
    const privacy = documents.find((row) => row.kind === 'PRIVACY_NOTICE')!;
    expect(privacy.body.length).toBeGreaterThan(50);
    expect(privacy.identifier).toBeTruthy();
    expect(privacy.effectiveFrom).toBeInstanceOf(Date);
  });

  it('leaves out one that has not yet taken effect', async () => {
    await publish('PRIVACY_NOTICE', { title: 'From next month', effectiveFrom: new Date(Date.now() + 30 * 86_400_000) });
    expect(await currentPublicAgreements()).toEqual([]);
  });

  it('is empty when nothing has been published, which the page says plainly', async () => {
    expect(await currentPublicAgreements()).toEqual([]);
  });
});

describe('signing up', () => {
  const PHONE = '08031234567';

  it('asks for nothing when there is no privacy notice to accept', async () => {
    const result = await startRegistration({ phone: PHONE, fullName: 'Amina Yusuf' });
    expect(result.existing).toBe(false);
  });

  it('is refused without acceptance once a privacy notice is in force, and leaves nothing behind', async () => {
    await publish('PRIVACY_NOTICE');

    await expect(startRegistration({ phone: PHONE, fullName: 'Amina Yusuf' })).rejects.toMatchObject({
      code: 'terms_not_accepted',
      status: 422,
    });
    expect(await prisma.user.count({ where: { phone: '+2348031234567' } })).toBe(0);
    expect(await prisma.otpCode.count()).toBe(0);
  });

  it('records what was accepted, and from where, when it is', async () => {
    const notice = await publish('PRIVACY_NOTICE');

    const { userId } = await startRegistration({
      phone: PHONE,
      fullName: 'Amina Yusuf',
      acceptedTerms: true,
      ipAddress: '102.89.1.1',
      userAgent: 'Chrome on Android',
    });

    const acceptance = await prisma.agreementAcceptance.findFirstOrThrow({ where: { userId } });
    expect(acceptance.versionId).toBe(notice.id);
    expect(acceptance.ipAddress).toBe('102.89.1.1');
    expect(acceptance.userAgent).toBe('Chrome on Android');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'agreement.accepted' } });
    expect(audit.actorId).toBe(userId);
  });

  it('asks the same of somebody whose number is already registered, so it cannot be used to find out who is', async () => {
    await startRegistration({ phone: PHONE, fullName: 'Amina Yusuf' });
    await publish('PRIVACY_NOTICE');

    await expect(startRegistration({ phone: PHONE, fullName: 'Someone Else' })).rejects.toMatchObject({
      code: 'terms_not_accepted',
    });
  });

  it('does not record a second acceptance for a number that was already registered', async () => {
    await publish('PRIVACY_NOTICE');
    const first = await startRegistration({ phone: PHONE, fullName: 'Amina Yusuf', acceptedTerms: true });
    // Past the pause between one-time codes, which is not what is being tested.
    const second = await startRegistration({
      phone: PHONE,
      fullName: 'Amina Yusuf',
      acceptedTerms: true,
      now: new Date(Date.now() + 10 * 60_000),
    });

    expect(second.existing).toBe(true);
    expect(await prisma.agreementAcceptance.count({ where: { userId: first.userId } })).toBe(1);
  });
});
