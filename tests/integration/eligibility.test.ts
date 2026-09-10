import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { GET } from '@/app/api/v1/practitioners/eligibility/route';
import { issueSession } from '@/modules/auth/application/session-service';
import {
  activateEligiblePractitioners,
  getEligibility,
} from '@/modules/practitioners/application/eligibility';
import { createProfile } from '@/modules/practitioners/application/profile';
import {
  recordIdentityVerification,
  recordProfessionalRegistration,
} from '@/modules/practitioners/application/verification';
import { reviewCredential, submitCredential } from '@/modules/credentials/application/submission';
import { clearCookies } from './support/cookie-jar';
import {
  createCredentialRequirement,
  createCredentialType,
  createProfessionalCategory,
  createUser,
  grant,
} from './support/fixtures';

/**
 * Step 5.8: every reason a practitioner is not yet eligible to be matched,
 * computed at once (src/modules/practitioners/domain/eligibility.ts has the
 * exhaustive unit coverage, including a 5000-profile property test) — this
 * file proves the rule is wired to real records, and to the nightly sweep
 * that acts on it.
 */

// reviewedBy has no FK constraint (matches audit.security_events.user_id),
// so a fixed id works fine as "someone other than the submitter".
const FAKE_REVIEWER_ID = '00000000-0000-0000-0000-0000000000aa';

let ninCounter = 0;
/** A fresh 11-digit NIN per call — identity_verifications.nin_hash is unique. */
function nextNin(): string {
  ninCounter += 1;
  return String(10_000_000_000 + ninCounter).slice(0, 11);
}

interface Setup {
  userId: string;
}

async function setupPractitioner(
  options: {
    withProfile?: boolean;
    withIdentity?: boolean;
    identityNameMatch?: boolean;
    withRegistration?: boolean;
    registrationStatus?: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'STRUCK_OFF' | 'UNKNOWN';
    withCredential?: boolean;
    withScreening?: boolean;
  } = {},
): Promise<Setup> {
  const {
    withProfile = true,
    withIdentity = true,
    identityNameMatch = true,
    withRegistration = true,
    registrationStatus = 'ACTIVE',
    withCredential = true,
    withScreening = true,
  } = options;

  const category = await createProfessionalCategory({ regulator: 'TESTREG' });
  const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
  await createCredentialRequirement({
    professionalCategoryId: category.id,
    credentialTypeId: credentialType.id,
  });

  const user = await createUser({ status: 'UNDER_REVIEW' });

  if (withProfile) {
    await createProfile({ userId: user.id, professionalCategoryId: category.id, yearsOfExperience: 3 });
  }

  if (withIdentity) {
    await recordIdentityVerification({
      userId: user.id,
      nin: nextNin(),
      nameMatch: identityNameMatch,
      actorId: user.id,
    });
  }

  if (withRegistration) {
    await recordProfessionalRegistration({
      userId: user.id,
      regulator: 'TESTREG',
      folioNumber: `TESTREG-${user.id.slice(0, 8)}`,
      registrationStatus,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      actorId: user.id,
    });
  }

  if (withCredential) {
    const submitted = await submitCredential({
      userId: user.id,
      credentialTypeId: credentialType.id,
      referenceNumber: 'A123456789',
    });
    await reviewCredential({
      submissionId: submitted.id,
      reviewerId: FAKE_REVIEWER_ID,
      decision: 'approve',
    });
  }

  if (withScreening) {
    await prisma.screeningResult.create({
      data: { userId: user.id, status: 'CLEAR', screenedAt: new Date() },
    });
  }

  return { userId: user.id };
}

async function loginAsPractitioner(userId: string) {
  await grant({
    userId,
    roleKey: 'practitioner',
    permissions: ['practitioner.profile.read'],
    scopeType: 'SELF',
    scopeId: userId,
  });
  await issueSession({ userId });
}

interface ApiResult {
  status: number;
  body: { eligible?: boolean; blockers?: string[] };
}

async function callEligibility(query: Record<string, string>): Promise<ApiResult> {
  const params = new URLSearchParams(query);
  const response = await GET(
    new Request(`http://localhost/api/v1/practitioners/eligibility?${params}`),
  );
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  clearCookies();
});

describe('getEligibility', () => {
  it('has no blockers once every requirement is met', async () => {
    const { userId } = await setupPractitioner();
    expect(await getEligibility(userId)).toEqual({ eligible: true, blockers: [] });
  });

  it('reports a missing profile', async () => {
    const { userId } = await setupPractitioner({ withProfile: false });
    const result = await getEligibility(userId);
    expect(result.eligible).toBe(false);
    expect(result.blockers).toContain('profile_incomplete');
  });

  it('reports a missing mandatory credential', async () => {
    const { userId } = await setupPractitioner({ withCredential: false });
    const result = await getEligibility(userId);
    expect(result.blockers).toContain('credential_missing');
  });

  it('reports an identity name mismatch', async () => {
    const { userId } = await setupPractitioner({ identityNameMatch: false });
    const result = await getEligibility(userId);
    expect(result.blockers).toContain('identity_name_mismatch');
  });

  it('reports a non-active registration', async () => {
    const { userId } = await setupPractitioner({ registrationStatus: 'SUSPENDED' });
    const result = await getEligibility(userId);
    expect(result.blockers).toContain('registration_not_active');
  });

  it('treats unscreened as not clear', async () => {
    const { userId } = await setupPractitioner({ withScreening: false });
    const result = await getEligibility(userId);
    expect(result.blockers).toContain('screening_not_clear');
  });
});

describe('GET /api/v1/practitioners/eligibility', () => {
  it('is refused without a session', async () => {
    expect((await callEligibility({ scopeType: 'SELF' })).status).toBe(401);
  });

  it("lets a practitioner read their own eligibility at SELF scope", async () => {
    const { userId } = await setupPractitioner();
    await loginAsPractitioner(userId);

    const result = await callEligibility({ scopeType: 'SELF' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ eligible: true, blockers: [] });
  });

  it("lets a compliance officer read a different practitioner's eligibility at PLATFORM scope", async () => {
    const { userId } = await setupPractitioner({ withCredential: false });

    const officer = await createUser();
    await grant({
      userId: officer.id,
      roleKey: 'compliance_officer',
      permissions: ['practitioner.profile.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: officer.id });

    const result = await callEligibility({ scopeType: 'PLATFORM', scopeId: userId });
    expect(result.status).toBe(200);
    expect(result.body.blockers).toContain('credential_missing');
  });

  it("refuses a practitioner reading someone else's eligibility via SELF", async () => {
    const { userId: ownerId } = await setupPractitioner();
    const { userId: otherId } = await setupPractitioner();

    await loginAsPractitioner(ownerId);
    expect((await callEligibility({ scopeType: 'SELF', scopeId: otherId })).status).toBe(403);
  });
});

describe('activateEligiblePractitioners', () => {
  it('promotes an UNDER_REVIEW practitioner who meets every requirement', async () => {
    const { userId } = await setupPractitioner();

    const result = await activateEligiblePractitioners();
    expect(result.activated).toBeGreaterThanOrEqual(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe('ACTIVE');

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: 'practitioner.activated', entityId: userId },
    });
    expect(auditRow).not.toBeNull();
  });

  it('leaves an UNDER_REVIEW practitioner alone if anything is still missing', async () => {
    const { userId } = await setupPractitioner({ withScreening: false });

    await activateEligiblePractitioners();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.status).toBe('UNDER_REVIEW');
  });

  it('does not touch an already-ACTIVE or a SUSPENDED account', async () => {
    const activeUser = await createUser({ status: 'ACTIVE' });
    const suspendedUser = await createUser({ status: 'SUSPENDED' });

    await activateEligiblePractitioners();

    expect((await prisma.user.findUniqueOrThrow({ where: { id: activeUser.id } })).status).toBe(
      'ACTIVE',
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: suspendedUser.id } })).status).toBe(
      'SUSPENDED',
    );
  });

  it('does not activate the same practitioner twice across two sweep passes', async () => {
    const { userId } = await setupPractitioner();

    await activateEligiblePractitioners();
    await activateEligiblePractitioners();

    const auditRows = await prisma.auditLog.findMany({
      where: { action: 'practitioner.activated', entityId: userId },
    });
    expect(auditRows).toHaveLength(1);
  });
});
