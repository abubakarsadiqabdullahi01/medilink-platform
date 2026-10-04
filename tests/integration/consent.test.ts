import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import {
  acceptAgreement,
  currentAgreements,
  currentConsent,
  publishAgreement,
  recordConsent,
} from '@/modules/audit-compliance/application/consent';
import {
  assessErasure,
  closeRequest,
  exportSubjectData,
  listRequests,
  raiseRequest,
} from '@/modules/audit-compliance/application/data-subject';
import { clearCookies } from './support/cookie-jar';
import { createUser } from './support/fixtures';

/**
 * Module 17's consent and compliance half.
 *
 * What a pure test cannot cover: that a withdrawal leaves the grant readable,
 * that an accepted agreement survives the version being retired, and — the
 * one that matters most — that the export contains what it should and
 * nothing it should not.
 */

beforeEach(() => {
  clearCookies();
});

describe('consent', () => {
  it('starts with nothing granted', async () => {
    const user = await createUser({ fullName: 'Adaeze Nwosu' });
    const consent = await currentConsent(user.id);

    expect(consent.every((row) => !row.granted)).toBe(true);
    // Every purpose is listed even before anybody decides, so the page can
    // show what the platform would like and why.
    expect(consent).toHaveLength(4);
  });

  it('grants and withdraws, keeping both on the record', async () => {
    const user = await createUser({ fullName: 'Ibrahim Sule' });

    await recordConsent({
      userId: user.id,
      purpose: 'MARKETING',
      granted: true,
      actorId: user.id,
    });
    await recordConsent({
      userId: user.id,
      purpose: 'MARKETING',
      granted: false,
      note: 'Too many messages.',
      actorId: user.id,
    });

    const current = await currentConsent(user.id);
    expect(current.find((row) => row.purpose === 'MARKETING')?.granted).toBe(false);

    // Both rows survive. "They consented in March and withdrew in June" is
    // the answer a regulator asks for, and an UPDATE would leave half of it.
    const rows = await prisma.consentRecord.findMany({
      where: { userId: user.id, purpose: 'MARKETING' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.granted)).toHaveLength(1);
  });

  it('refuses to withdraw what never rested on consent', async () => {
    const user = await createUser({ fullName: 'Folake Adeyemi' });

    // A licence check runs because a regulator requires it. A button that
    // pretended otherwise would be a lie with a 200 on it.
    await expect(
      recordConsent({
        userId: user.id,
        purpose: 'IDENTITY_VERIFICATION',
        granted: false,
        note: 'I would rather you did not.',
        actorId: user.id,
      }),
    ).rejects.toThrow(/not consent/);
  });

  it('requires a reason to withdraw', async () => {
    const user = await createUser({ fullName: 'Emeka Obi' });
    await recordConsent({
      userId: user.id,
      purpose: 'PROFILE_VISIBILITY',
      granted: true,
      actorId: user.id,
    });

    await expect(
      recordConsent({
        userId: user.id,
        purpose: 'PROFILE_VISIBILITY',
        granted: false,
        actorId: user.id,
      }),
    ).rejects.toThrow(/why/i);
  });

  it('audits every change', async () => {
    const user = await createUser({ fullName: 'Hauwa Danjuma' });
    await recordConsent({
      userId: user.id,
      purpose: 'MARKETING',
      granted: true,
      actorId: user.id,
    });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'consent.granted', scopeId: user.id },
    });
    expect(audit).not.toBeNull();
  });
});

describe('agreements', () => {
  async function publish(identifier: string, body = 'A'.repeat(80)) {
    const officer = await createUser({ fullName: 'Config Officer' });
    return publishAgreement({
      kind: 'PRACTITIONER_ENGAGEMENT',
      identifier,
      title: 'Engagement terms',
      body,
      actorId: officer.id,
    });
  }

  it('records the version accepted, not the file', async () => {
    const user = await createUser({ fullName: 'Chioma Eze' });
    const version = await publish(`engagement-${Date.now()}`);

    const result = await acceptAgreement({ userId: user.id, versionId: version.id });
    expect(result.identifier).toBe(version.identifier);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'agreement.accepted', scopeId: user.id },
    });
    // The identifier is what pins down what was agreed; a title can be edited.
    expect(JSON.stringify(audit?.after)).toContain(version.identifier);
  });

  it('will not accept the same version twice', async () => {
    const user = await createUser({ fullName: 'Segun Balogun' });
    const version = await publish(`engagement-dup-${Date.now()}`);

    await acceptAgreement({ userId: user.id, versionId: version.id });
    await expect(
      acceptAgreement({ userId: user.id, versionId: version.id }),
    ).rejects.toThrow(/already accepted/);
  });

  it('keeps an old acceptance readable after the version is retired', async () => {
    const user = await createUser({ fullName: 'Zainab Aliyu' });
    const first = await publish(`engagement-old-${Date.now()}`);
    await acceptAgreement({ userId: user.id, versionId: first.id });

    // Publishing a replacement retires the first.
    await publish(`engagement-new-${Date.now()}`);

    const retired = await prisma.agreementVersion.findUniqueOrThrow({ where: { id: first.id } });
    expect(retired.retiredAt).not.toBeNull();

    // What they agreed to before is still there, with its body intact.
    const acceptance = await prisma.agreementAcceptance.findFirstOrThrow({
      where: { userId: user.id },
      include: { version: true },
    });
    expect(acceptance.version.identifier).toBe(first.identifier);
    expect(acceptance.version.body.length).toBeGreaterThan(50);

    // And the current list offers the new one, unaccepted.
    const current = await currentAgreements(user.id, 'PRACTITIONER');
    const engagement = current.find((row) => row.kind === 'PRACTITIONER_ENGAGEMENT');
    expect(engagement?.acceptedAt).toBeNull();
  });
});

describe('data subject requests', () => {
  it('stamps a deadline a month out at creation', async () => {
    const user = await createUser({ fullName: 'Musa Yakubu' });
    const request = await raiseRequest({ userId: user.id, kind: 'ACCESS' });

    const days = (request.dueBy.getTime() - request.receivedAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    expect(request.overdue).toBe(false);
  });

  it('refuses to close one with no outcome', async () => {
    const user = await createUser({ fullName: 'Blessing Okoro' });
    const officer = await createUser({ fullName: 'Compliance Officer' });
    const request = await raiseRequest({ userId: user.id, kind: 'ACCESS' });

    await expect(
      closeRequest({
        requestId: request.id,
        actorId: officer.id,
        status: 'COMPLETED',
        outcome: '   ',
      }),
    ).rejects.toThrow(/say what was done/i);
  });

  it('records a refusal as carefully as a grant', async () => {
    const user = await createUser({ fullName: 'Tunde Bakare' });
    const officer = await createUser({ fullName: 'Compliance Officer' });
    const request = await raiseRequest({ userId: user.id, kind: 'ERASURE' });

    const closed = await closeRequest({
      requestId: request.id,
      actorId: officer.id,
      status: 'REFUSED',
      outcome: 'You are owed money for two shifts. Ask again once those are settled.',
    });

    expect(closed.status).toBe('REFUSED');
    expect(closed.outcome).toContain('owed money');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'data_subject.refused', entityId: request.id },
    });
    expect(audit?.reason).toContain('owed money');
  });

  it('will not answer the same request twice', async () => {
    const user = await createUser({ fullName: 'Ngozi Ike' });
    const officer = await createUser({ fullName: 'Compliance Officer' });
    const request = await raiseRequest({ userId: user.id, kind: 'ACCESS' });

    await closeRequest({
      requestId: request.id,
      actorId: officer.id,
      status: 'COMPLETED',
      outcome: 'Export sent to their registered address.',
    });
    await expect(
      closeRequest({
        requestId: request.id,
        actorId: officer.id,
        status: 'REFUSED',
        outcome: 'Changing my mind after the fact.',
      }),
    ).rejects.toThrow(/already been answered/);
  });

  it('queues the closest deadline first', async () => {
    const user = await createUser({ fullName: 'Yusuf Garba' });
    await raiseRequest({ userId: user.id, kind: 'ACCESS' });
    await raiseRequest({ userId: user.id, kind: 'PORTABILITY' });

    const queue = await listRequests('RECEIVED');
    for (let index = 1; index < queue.length; index += 1) {
      expect(queue[index]!.dueBy.getTime()).toBeGreaterThanOrEqual(
        queue[index - 1]!.dueBy.getTime(),
      );
    }
  });
});

describe('the export', () => {
  it('contains the account and the consent record', async () => {
    const user = await createUser({ fullName: 'Amaka Obiora' });
    await recordConsent({
      userId: user.id,
      purpose: 'MARKETING',
      granted: true,
      actorId: user.id,
    });

    const data = await exportSubjectData(user.id);
    expect(data.account.id).toBe(user.id);
    expect(data.account.fullName).toBe('Amaka Obiora');
    expect(data.consent.length).toBeGreaterThan(0);
  });

  it('never contains the audit trail, the ledger, or a NIN', async () => {
    const user = await createUser({ fullName: 'Kunle Ade' });
    const data = await exportSubjectData(user.id);
    const serialised = JSON.stringify(data);

    /**
     * The commonest way a subject access request goes wrong is disclosing
     * somebody else's data in answer to it. An audit row names other people
     * and a ledger entry has another party on the other side, so neither
     * belongs here — and the export says so rather than leaving a gap.
     */
    expect(Object.keys(data)).not.toContain('auditTrail');
    expect(Object.keys(data)).not.toContain('ledger');
    expect(serialised).not.toContain('ninDigest');
    expect(data.notIncluded.auditTrail.length).toBeGreaterThan(30);
    expect(data.notIncluded.ledger.length).toBeGreaterThan(30);
  });

  it('names every section it promises', async () => {
    const user = await createUser({ fullName: 'Rita Musa' });
    const data = await exportSubjectData(user.id);

    // A module gaining a table of personal data must add it here; this is
    // what makes a silent omission visible.
    for (const key of [
      'account',
      'profile',
      'identityVerification',
      'professionalRegistrations',
      'credentials',
      'availability',
      'invitations',
      'assignments',
      'consent',
      'agreementsAccepted',
      'dataSubjectRequests',
      'payouts',
    ]) {
      expect(Object.keys(data), key).toContain(key);
    }
  });
});

describe('erasure', () => {
  it('can proceed for somebody with nothing outstanding', async () => {
    const user = await createUser({ fullName: 'Peter Uche' });
    const assessment = await assessErasure(user.id);

    expect(assessment.canProceed).toBe(true);
    expect(assessment.blockers).toEqual([]);
    // Said whether or not it can proceed, because it is the part people are
    // surprised by and being surprised later is worse.
    expect(assessment.whatErasureDoes).toContain('cannot be deleted');
  });
});
