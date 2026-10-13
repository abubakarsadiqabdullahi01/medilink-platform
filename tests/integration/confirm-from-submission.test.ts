import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { POST as confirm } from '@/app/api/v1/practitioners/verification/confirm/route';
import { POST as review } from '@/app/api/v1/credentials/[id]/review/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { createProfile } from '@/modules/practitioners/application/profile';
import {
  resupplyCredential,
  reviewCredential,
  submitCredential,
} from '@/modules/credentials/application/submission';
import { clearCookies } from './support/cookie-jar';
import {
  createCredentialType,
  createProfessionalCategory,
  createUser,
  grant,
} from './support/fixtures';

/**
 * Confirming what a practitioner submitted, rather than retyping it.
 *
 * An officer reads the photograph beside the number and confirms once; the
 * identity or registration is recorded from the submission and the submission
 * is decided in the same act. What is proved here is as much what it refuses —
 * nothing half-recorded, nothing approved on the officer's behalf — as what it
 * does, and that a whole NIN never reaches the audit trail.
 */

interface ApiResult {
  status: number;
  body: Record<string, unknown> & { error?: { code: string } };
}

const NIN = '99000000022';

async function post(
  handler: (request: Request, props: { params: Promise<{ id: string }> }) => Promise<Response>,
  url: string,
  body: unknown,
  id = 'none',
): Promise<ApiResult> {
  const response = await handler(
    new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json() };
}

const confirmIdentity = (body: Record<string, unknown>) =>
  post(confirm as never, '/api/v1/practitioners/verification/confirm', { kind: 'identity', ...body });
const confirmRegistration = (body: Record<string, unknown>) =>
  post(confirm as never, '/api/v1/practitioners/verification/confirm', {
    kind: 'registration',
    ...body,
  });

async function signInAsOfficer() {
  clearCookies();
  const officer = await createUser();
  await grant({
    userId: officer.id,
    roleKey: 'compliance_officer_probe',
    permissions: ['credential.review'],
    scopeType: 'PLATFORM',
  });
  await issueSession({ userId: officer.id });
  return officer;
}

/** A practitioner with a profile, and one waiting submission of the given kind. */
async function submission(options: { method: 'nimc_verification' | 'mdcn_status_check'; reference: string }) {
  const category = await createProfessionalCategory({ regulator: 'TESTREG' });
  const type = await createCredentialType({ verificationMethod: options.method });
  const practitioner = await createUser({ status: 'UNDER_REVIEW' });
  await createProfile({
    userId: practitioner.id,
    professionalCategoryId: category.id,
    yearsOfExperience: 4,
  });
  const submitted = await submitCredential({
    userId: practitioner.id,
    credentialTypeId: type.id,
    referenceNumber: options.reference,
  });
  return { practitioner, submitted, category, type };
}

const rowOf = (id: string) => prisma.credentialSubmission.findUniqueOrThrow({ where: { id } });

beforeEach(() => {
  clearCookies();
});

describe('who may confirm', () => {
  it('is told to sign in without a session', async () => {
    const { submitted } = await submission({ method: 'nimc_verification', reference: NIN });
    clearCookies();
    expect((await confirmIdentity({ submissionId: submitted.id, nameMatch: true })).status).toBe(401);
  });

  it('is refused to a practitioner, who cannot confirm their own', async () => {
    const { practitioner, submitted } = await submission({
      method: 'nimc_verification',
      reference: NIN,
    });
    clearCookies();
    await grant({
      userId: practitioner.id,
      roleKey: 'practitioner',
      permissions: ['practitioner.profile.read', 'practitioner.profile.write'],
      scopeType: 'SELF',
      scopeId: practitioner.id,
    });
    await issueSession({ userId: practitioner.id });

    expect((await confirmIdentity({ submissionId: submitted.id, nameMatch: true })).status).toBe(403);
    expect((await rowOf(submitted.id)).status).toBe('PENDING');
  });

  it('is refused to an officer reviewing their own submission, before anything is recorded', async () => {
    const officer = await signInAsOfficer();
    const category = await createProfessionalCategory({ regulator: 'TESTREG' });
    const type = await createCredentialType({ verificationMethod: 'nimc_verification' });
    await createProfile({
      userId: officer.id,
      professionalCategoryId: category.id,
      yearsOfExperience: 1,
    });
    const own = await submitCredential({
      userId: officer.id,
      credentialTypeId: type.id,
      referenceNumber: NIN,
    });

    const refused = await confirmIdentity({ submissionId: own.id, nameMatch: true });
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('cannot_review_own_submission');
    expect(await prisma.identityVerification.count({ where: { userId: officer.id } })).toBe(0);
  });
});

describe('confirming an identity', () => {
  it('records it from the submitted number, approves the submission and masks the number', async () => {
    const { practitioner, submitted } = await submission({
      method: 'nimc_verification',
      reference: NIN,
    });
    const officer = await signInAsOfficer();

    const done = await confirmIdentity({ submissionId: submitted.id, nameMatch: true });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ outcome: 'CONFIRMED' });

    // Recorded from what was submitted: the officer typed nothing.
    const identity = await prisma.identityVerification.findUniqueOrThrow({
      where: { userId: practitioner.id },
    });
    expect(identity).toMatchObject({
      ninLast4: '0022',
      nameMatch: true,
      method: 'MANUAL',
      verifiedBy: officer.id,
    });

    const row = await rowOf(submitted.id);
    expect(row.status).toBe('VERIFIED');
    expect(row.reviewedBy).toBe(officer.id);
    // The number has done its job; only the tail is kept.
    expect(row.referenceNumber).toBe('*******0022');
  });

  it('never lets the whole number reach the audit trail', async () => {
    const { submitted } = await submission({ method: 'nimc_verification', reference: NIN });
    await signInAsOfficer();
    await confirmIdentity({ submissionId: submitted.id, nameMatch: true });

    // Everything written during the whole journey — submitting, reviewing,
    // recording the identity, masking. The trail is append-only: a NIN written
    // there could never be taken back out.
    const trail = await prisma.auditLog.findMany();
    expect(trail.length).toBeGreaterThan(0);
    expect(JSON.stringify(trail)).not.toContain(NIN);
    expect(JSON.stringify(trail)).toContain('*******0022');
  });

  it('records a mismatch as a fact and asks the practitioner to correct it, without approving', async () => {
    const { practitioner, submitted } = await submission({
      method: 'nimc_verification',
      reference: NIN,
    });
    await signInAsOfficer();

    const done = await confirmIdentity({ submissionId: submitted.id, nameMatch: false });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ outcome: 'NAME_MISMATCH' });

    expect(
      (await prisma.identityVerification.findUniqueOrThrow({ where: { userId: practitioner.id } }))
        .nameMatch,
    ).toBe(false);

    const row = await rowOf(submitted.id);
    expect(row.status).toBe('MORE_INFO_REQUESTED');
    expect(row.reviewNotes).toMatch(/does not match/i);
    // Not left whole. They will send a corrected number, so there is nothing to
    // keep the old one for, and a mismatched submission that sat here in full
    // would be the one place a NIN stayed readable for good.
    expect(row.referenceNumber).toBe('*******0022');
  });

  it('asks for the number again rather than resupplying against a masked one', async () => {
    const { practitioner, submitted } = await submission({
      method: 'nimc_verification',
      reference: NIN,
    });
    await signInAsOfficer();
    await confirmIdentity({ submissionId: submitted.id, nameMatch: false });

    await expect(
      resupplyCredential({ submissionId: submitted.id, userId: practitioner.id }),
    ).rejects.toMatchObject({ code: 'reference_number_required' });

    const corrected = await resupplyCredential({
      submissionId: submitted.id,
      userId: practitioner.id,
      referenceNumber: '99000000033',
    });
    expect(corrected.status).toBe('PENDING');
    expect(corrected.referenceNumber).toBe('99000000033');
  });

  it.each(['reject', 'request_info'] as const)(
    'masks the number when an officer decides %s on a NIN, wherever the decision comes from',
    async (decision) => {
      const { submitted } = await submission({ method: 'nimc_verification', reference: NIN });
      const officer = await signInAsOfficer();

      await reviewCredential({
        submissionId: submitted.id,
        reviewerId: officer.id,
        decision,
        reviewNotes: 'The slip is unreadable; please send it again.',
      });

      expect((await rowOf(submitted.id)).referenceNumber).toBe('*******0022');
      expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(NIN);
    },
  );

  it('leaves a registration number whole: it is public, and the officer re-reads it', async () => {
    const { submitted } = await submission({ method: 'mdcn_status_check', reference: 'MDCN/R/12345' });
    const officer = await signInAsOfficer();

    await reviewCredential({
      submissionId: submitted.id,
      reviewerId: officer.id,
      decision: 'request_info',
      reviewNotes: 'Which register is this on?',
    });

    expect((await rowOf(submitted.id)).referenceNumber).toBe('MDCN/R/12345');
  });

  it('refuses when the officer has not said whether the name matched, and changes nothing', async () => {
    // There is no sensible default: assuming a match would let a mismatched
    // identity through silently.
    const { practitioner, submitted } = await submission({
      method: 'nimc_verification',
      reference: NIN,
    });
    await signInAsOfficer();

    const refused = await confirmIdentity({ submissionId: submitted.id });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe('name_match_required');
    expect(await prisma.identityVerification.count({ where: { userId: practitioner.id } })).toBe(0);
    expect((await rowOf(submitted.id)).status).toBe('PENDING');
  });

  it('refuses a submitted number that is not a NIN, telling the officer what to do', async () => {
    const { practitioner, submitted } = await submission({
      method: 'nimc_verification',
      reference: 'A123456789',
    });
    await signInAsOfficer();

    const refused = await confirmIdentity({ submissionId: submitted.id, nameMatch: true });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe('submission_not_confirmable');
    expect(JSON.stringify(refused.body)).toMatch(/Ask them for more information/);
    expect(await prisma.identityVerification.count({ where: { userId: practitioner.id } })).toBe(0);
  });

  it('refuses a submission that has already been decided', async () => {
    const { submitted } = await submission({ method: 'nimc_verification', reference: NIN });
    await signInAsOfficer();
    await confirmIdentity({ submissionId: submitted.id, nameMatch: true });

    const again = await confirmIdentity({ submissionId: submitted.id, nameMatch: true });
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe('already_reviewed');
  });

  it('refuses a submission of the wrong kind', async () => {
    const { submitted } = await submission({ method: 'mdcn_status_check', reference: 'N-12345' });
    await signInAsOfficer();

    const refused = await confirmIdentity({ submissionId: submitted.id, nameMatch: true });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe('submission_not_confirmable');
  });
});

describe('confirming a registration', () => {
  it('records it against their profession’s regulator, from the submitted number', async () => {
    const { practitioner, submitted } = await submission({
      method: 'mdcn_status_check',
      reference: 'N-12345',
    });
    await signInAsOfficer();

    const done = await confirmRegistration({
      submissionId: submitted.id,
      registrationStatus: 'ACTIVE',
      expiresAt: '2027-06-30',
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ outcome: 'CONFIRMED' });

    const registration = await prisma.professionalRegistration.findFirstOrThrow({
      where: { userId: practitioner.id },
    });
    // The regulator is their profession's, not anything typed.
    expect(registration).toMatchObject({
      regulator: 'TESTREG',
      folioNumber: 'N-12345',
      registrationStatus: 'ACTIVE',
      source: 'MANUAL',
    });
    expect(registration.expiresAt?.toISOString().slice(0, 10)).toBe('2027-06-30');
    expect((await rowOf(submitted.id)).status).toBe('VERIFIED');
  });

  it('records a suspended licence as it is, and rejects the submission with the reason', async () => {
    const { practitioner, submitted } = await submission({
      method: 'mdcn_status_check',
      reference: 'N-12345',
    });
    await signInAsOfficer();

    const done = await confirmRegistration({
      submissionId: submitted.id,
      registrationStatus: 'SUSPENDED',
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ outcome: 'NOT_ACTIVE' });

    expect(
      (await prisma.professionalRegistration.findFirstOrThrow({ where: { userId: practitioner.id } }))
        .registrationStatus,
    ).toBe('SUSPENDED');
    const row = await rowOf(submitted.id);
    expect(row.status).toBe('REJECTED');
    expect(row.reviewNotes).toMatch(/suspended/i);
  });

  it('refuses when the officer has not said what the licence shows, and changes nothing', async () => {
    const { practitioner, submitted } = await submission({
      method: 'mdcn_status_check',
      reference: 'N-12345',
    });
    await signInAsOfficer();

    const refused = await confirmRegistration({ submissionId: submitted.id });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe('registration_status_required');
    expect(await prisma.professionalRegistration.count({ where: { userId: practitioner.id } })).toBe(0);
    expect((await rowOf(submitted.id)).status).toBe('PENDING');
  });
});

describe('the plain review route', () => {
  it('will not approve a number checked against a record, and says where to go', async () => {
    // "Verify" on a NIN would mark it good and leave the practitioner still
    // blocked on an identity nobody recorded.
    const { submitted } = await submission({ method: 'nimc_verification', reference: NIN });
    await signInAsOfficer();

    const refused = await post(review, `/api/v1/credentials/${submitted.id}/review`, { decision: 'approve' }, submitted.id);
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe('confirm_through_practitioner');
    expect((await rowOf(submitted.id)).status).toBe('PENDING');
  });

  it('still lets an officer ask for more, or reject, on one', async () => {
    const { submitted } = await submission({ method: 'nimc_verification', reference: NIN });
    await signInAsOfficer();

    const asked = await post(
      review,
      `/api/v1/credentials/${submitted.id}/review`,
      { decision: 'request_info', reviewNotes: 'The photograph is too dark to read.' },
      submitted.id,
    );
    expect(asked.status).toBe(200);
  });

  it('still approves a document-reviewed credential in one click', async () => {
    const category = await createProfessionalCategory();
    const type = await createCredentialType({ verificationMethod: 'document_review' });
    const practitioner = await createUser({ status: 'UNDER_REVIEW' });
    await createProfile({
      userId: practitioner.id,
      professionalCategoryId: category.id,
      yearsOfExperience: 2,
    });
    // A document-reviewed credential needs a stored document; go straight to
    // the row, since what is under test is the route's decision, not uploading.
    const row = await prisma.credentialSubmission.create({
      data: {
        userId: practitioner.id,
        credentialTypeId: type.id,
        documentObjectKey: 'test/doc.pdf',
      },
    });
    await signInAsOfficer();

    const approved = await post(review, `/api/v1/credentials/${row.id}/review`, { decision: 'approve' }, row.id);
    expect(approved.status).toBe(200);
  });
});
