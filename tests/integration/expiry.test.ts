import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { EVENTS } from '@/lib/events';
import { expireCredentials } from '@/modules/credentials/application/expiry';
import { expireRegistrations } from '@/modules/practitioners/application/expiry';
import { createCredentialType, createUser } from './support/fixtures';

/**
 * Step 5.9: a VERIFIED credential or an ACTIVE registration whose expiry has
 * passed stops counting — without suspending the account. Suspension stays a
 * compliance officer's decision; the eligibility rule (Step 5.8) already
 * refuses a lapsed credential or registration for matching purposes the
 * moment it lapses, before either sweep here has even run.
 *
 * Both sweeps are wired into src/worker/jobs.ts — tests/integration/scheduler.test.ts's
 * "the job registry" test already asserts every JOB_DEFINITIONS key has a
 * handler and vice versa, so that consistency isn't re-checked here.
 */

describe('credential expiry', () => {
  it('moves a VERIFIED submission past its expiry to EXPIRED, audited and published', async () => {
    const credentialType = await createCredentialType({
      verificationMethod: 'nimc_verification',
      expires: true,
      reviewDays: 30,
    });
    const user = await createUser();
    const submission = await prisma.credentialSubmission.create({
      data: {
        userId: user.id,
        credentialTypeId: credentialType.id,
        referenceNumber: 'A1',
        status: 'VERIFIED',
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const result = await expireCredentials();
    expect(result.expired).toBe(1);

    const updated = await prisma.credentialSubmission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    expect(updated.status).toBe('EXPIRED');

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'credential.expired', entityId: submission.id },
    });
    expect(auditRow).not.toBeNull();

    const events = await prisma.outboxEvent.findMany({
      where: { eventType: EVENTS.CredentialExpired, aggregateId: submission.id },
    });
    expect(events).toHaveLength(1);
  });

  it('leaves a submission alone whose expiry has not passed yet', async () => {
    const credentialType = await createCredentialType({ expires: true, reviewDays: 30 });
    const user = await createUser();
    const submission = await prisma.credentialSubmission.create({
      data: {
        userId: user.id,
        credentialTypeId: credentialType.id,
        referenceNumber: 'A1',
        status: 'VERIFIED',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expireCredentials();

    const unchanged = await prisma.credentialSubmission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    expect(unchanged.status).toBe('VERIFIED');
  });

  it('does not touch a REJECTED submission, whatever its expiresAt says', async () => {
    // expiresAt is only ever set on VERIFIED rows in practice, but it's the
    // sweep's own WHERE clause that enforces this, not caller discipline.
    const credentialType = await createCredentialType({ expires: true, reviewDays: 30 });
    const user = await createUser();
    const submission = await prisma.credentialSubmission.create({
      data: {
        userId: user.id,
        credentialTypeId: credentialType.id,
        referenceNumber: 'A1',
        status: 'REJECTED',
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await expireCredentials();

    const unchanged = await prisma.credentialSubmission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    expect(unchanged.status).toBe('REJECTED');
  });
});

describe('registration expiry', () => {
  it('moves an ACTIVE registration past its expiry to EXPIRED, audited', async () => {
    const user = await createUser();
    const registration = await prisma.professionalRegistration.create({
      data: {
        userId: user.id,
        regulator: 'MDCN',
        folioNumber: `MDCN-${user.id.slice(0, 8)}`,
        registrationStatus: 'ACTIVE',
        evidenceRetrievedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        source: 'MANUAL',
      },
    });

    const result = await expireRegistrations();
    expect(result.expired).toBe(1);

    const updated = await prisma.professionalRegistration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(updated.registrationStatus).toBe('EXPIRED');

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'practitioner.registration_expired', entityId: registration.id },
    });
    expect(auditRow).not.toBeNull();
  });

  it('leaves a SUSPENDED registration alone even past its expiry date', async () => {
    const user = await createUser();
    const registration = await prisma.professionalRegistration.create({
      data: {
        userId: user.id,
        regulator: 'MDCN',
        folioNumber: `MDCN-${user.id.slice(0, 8)}`,
        registrationStatus: 'SUSPENDED',
        evidenceRetrievedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        source: 'MANUAL',
      },
    });

    await expireRegistrations();

    const unchanged = await prisma.professionalRegistration.findUniqueOrThrow({
      where: { id: registration.id },
    });
    expect(unchanged.registrationStatus).toBe('SUSPENDED');
  });
});
