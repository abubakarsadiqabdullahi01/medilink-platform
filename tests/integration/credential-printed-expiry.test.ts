import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

// Only headObject touches the network, and a stored row is all these cases need.
vi.mock('@/lib/storage/tigris', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/tigris')>();
  return { ...actual, headObject: vi.fn().mockResolvedValue({}) };
});

import { prisma } from '@/lib/db';
import { POST as postReview } from '@/app/api/v1/credentials/[id]/review/route';
import { POST as confirm } from '@/app/api/v1/practitioners/verification/confirm/route';
import { expireCredentials } from '@/modules/credentials/application/expiry';
import { reviewCredential, submitCredential } from '@/modules/credentials/application/submission';
import { issueSession } from '@/modules/auth/application/session-service';
import { createProfile } from '@/modules/practitioners/application/profile';
import { clearCookies } from './support/cookie-jar';
import {
  createCredentialType,
  createProfessionalCategory,
  createUser,
  grant,
} from './support/fixtures';

/**
 * CRE-04. A credential's expiry was the review date plus the type's review days,
 * so a practitioner was shown a date that appears nowhere on what they uploaded,
 * and a licence that said 2029 was treated as lapsing next year (or the other
 * way round). The reviewer reads the date off the document and records it; it
 * is that date the practitioner is shown and the sweeps act on.
 */

const lagosToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
const inYears = (years: number) => {
  const date = new Date(Date.now() + 3600_000);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
};

async function waiting(options: { expires?: boolean; reviewDays?: number } = {}) {
  const type = await createCredentialType({ verificationMethod: 'document_review', ...options });
  const practitioner = await createUser({ status: 'UNDER_REVIEW' });
  await prisma.storedObject.create({
    data: {
      bucket: 'test',
      objectKey: `credential_document/test/${practitioner.id}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 100,
      purpose: 'credential_document',
      ownerUserId: practitioner.id,
      uploadedAt: new Date(),
    },
  });
  const submitted = await submitCredential({
    userId: practitioner.id,
    credentialTypeId: type.id,
    documentObjectKey: `credential_document/test/${practitioner.id}.pdf`,
  });
  return { type, practitioner, submitted };
}

async function officer() {
  const user = await createUser();
  await grant({
    userId: user.id,
    roleKey: 'compliance_officer_expiry',
    permissions: ['credential.review'],
    scopeType: 'PLATFORM',
  });
  return user;
}

const rowOf = (id: string) => prisma.credentialSubmission.findUniqueOrThrow({ where: { id } });

beforeEach(() => {
  clearCookies();
});

describe('approving with the date printed on the document', () => {
  it('stores it, and the instant it ends is the end of that day in Lagos', async () => {
    const { submitted } = await waiting({ reviewDays: 365 });
    const reviewer = await officer();

    const view = await reviewCredential({
      submissionId: submitted.id,
      reviewerId: reviewer.id,
      decision: 'approve',
      printedExpiryDate: inYears(3),
    });

    expect(view.documentExpiresOn).toBe(inYears(3));
    const row = await rowOf(submitted.id);
    expect(row.documentExpiresOn?.toISOString().slice(0, 10)).toBe(inYears(3));
    // The end of the printed day in Lagos is 23:00 UTC the same date.
    expect(row.expiresAt?.toISOString()).toBe(`${inYears(3)}T23:00:00.000Z`);
  });

  it('is not cut short by the type\'s review days, which was the whole fault', async () => {
    const { submitted } = await waiting({ reviewDays: 30 });
    const reviewer = await officer();

    await reviewCredential({
      submissionId: submitted.id,
      reviewerId: reviewer.id,
      decision: 'approve',
      printedExpiryDate: inYears(2),
    });

    const row = await rowOf(submitted.id);
    expect(row.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 400 * 86_400_000);
  });

  it('falls back to the review interval when no date was read, and says so by leaving it empty', async () => {
    const { submitted } = await waiting({ reviewDays: 30 });
    const reviewer = await officer();

    const view = await reviewCredential({
      submissionId: submitted.id,
      reviewerId: reviewer.id,
      decision: 'approve',
    });

    expect(view.documentExpiresOn).toBeNull();
    const days = (view.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('puts the printed date on the audit row, which names no one', async () => {
    const { submitted } = await waiting();
    const reviewer = await officer();

    await reviewCredential({
      submissionId: submitted.id,
      reviewerId: reviewer.id,
      decision: 'approve',
      printedExpiryDate: inYears(1),
    });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'credential.verified' } });
    expect(JSON.stringify(row.after)).toContain(inYears(1));
  });

  it('is what the expiry sweep acts on: still verified on the day, expired once it has ended', async () => {
    const { submitted } = await waiting();
    const reviewer = await officer();
    await reviewCredential({
      submissionId: submitted.id,
      reviewerId: reviewer.id,
      decision: 'approve',
      printedExpiryDate: lagosToday(),
    });
    const endsAt = (await rowOf(submitted.id)).expiresAt!;
    expect(endsAt.toISOString()).toBe(`${lagosToday()}T23:00:00.000Z`);

    await expireCredentials(new Date(endsAt.getTime() - 60_000));
    expect((await rowOf(submitted.id)).status).toBe('VERIFIED');

    await expireCredentials(new Date(endsAt.getTime() + 60_000));
    expect((await rowOf(submitted.id)).status).toBe('EXPIRED');
  });
});

describe('what is refused', () => {
  it('a date that has already passed, leaving the submission waiting', async () => {
    const { submitted } = await waiting();
    const reviewer = await officer();

    await expect(
      reviewCredential({
        submissionId: submitted.id,
        reviewerId: reviewer.id,
        decision: 'approve',
        printedExpiryDate: '2020-01-31',
      }),
    ).rejects.toMatchObject({ code: 'printed_expiry_invalid', status: 422 });

    const row = await rowOf(submitted.id);
    expect(row.status).toBe('PENDING');
    expect(row.expiresAt).toBeNull();
  });

  it('a date so far ahead it is surely a typo', async () => {
    const { submitted } = await waiting();
    const reviewer = await officer();

    await expect(
      reviewCredential({
        submissionId: submitted.id,
        reviewerId: reviewer.id,
        decision: 'approve',
        printedExpiryDate: inYears(40),
      }),
    ).rejects.toMatchObject({ code: 'printed_expiry_invalid' });
  });

  it('a date for a credential that does not expire', async () => {
    const { submitted } = await waiting({ expires: false });
    const reviewer = await officer();

    await expect(
      reviewCredential({
        submissionId: submitted.id,
        reviewerId: reviewer.id,
        decision: 'approve',
        printedExpiryDate: inYears(2),
      }),
    ).rejects.toMatchObject({ code: 'printed_expiry_invalid' });
  });

  it('a date sent with a rejection, where it means nothing', async () => {
    const { submitted } = await waiting();
    const reviewer = await officer();

    await expect(
      reviewCredential({
        submissionId: submitted.id,
        reviewerId: reviewer.id,
        decision: 'reject',
        reviewNotes: 'Blurred.',
        printedExpiryDate: inYears(2),
      }),
    ).rejects.toMatchObject({ code: 'printed_expiry_invalid' });
    expect((await rowOf(submitted.id)).status).toBe('PENDING');
  });
});

describe('over the API', () => {
  async function callReview(id: string, body: unknown) {
    const response = await postReview(
      new Request(`http://localhost/api/v1/credentials/${id}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('takes printedExpiryDate and returns it', async () => {
    const { submitted } = await waiting();
    const reviewer = await officer();
    await issueSession({ userId: reviewer.id });

    const result = await callReview(submitted.id, { decision: 'approve', printedExpiryDate: inYears(2) });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ status: 'VERIFIED', documentExpiresOn: inYears(2) });
  });

  it('refuses a date written any way but year-month-day', async () => {
    const { submitted } = await waiting();
    const reviewer = await officer();
    await issueSession({ userId: reviewer.id });

    const result = await callReview(submitted.id, { decision: 'approve', printedExpiryDate: '31/03/2029' });

    expect(result.status).toBe(422);
  });

  it('refuses a date alongside a rejection', async () => {
    const { submitted } = await waiting();
    const reviewer = await officer();
    await issueSession({ userId: reviewer.id });

    const result = await callReview(submitted.id, {
      decision: 'reject',
      reviewNotes: 'Blurred.',
      printedExpiryDate: inYears(2),
    });

    expect(result.status).toBe(422);
  });
});

describe('confirming a licence, where the expiry is already read off it', () => {
  async function licence() {
    const category = await createProfessionalCategory({ regulator: 'TESTREG' });
    const type = await createCredentialType({ verificationMethod: 'mdcn_status_check' });
    const practitioner = await createUser({ status: 'UNDER_REVIEW' });
    await createProfile({ userId: practitioner.id, professionalCategoryId: category.id, yearsOfExperience: 4 });
    const submitted = await submitCredential({
      userId: practitioner.id,
      credentialTypeId: type.id,
      referenceNumber: 'N-12345',
    });
    return { practitioner, submitted };
  }

  async function confirmRegistration(body: Record<string, unknown>) {
    const reviewer = await officer();
    clearCookies();
    await issueSession({ userId: reviewer.id });
    const response = await confirm(
      new Request('http://localhost/api/v1/practitioners/verification/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'registration', ...body }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('gives the credential the licence\'s own date, the one the practitioner then sees', async () => {
    const { submitted } = await licence();

    const done = await confirmRegistration({
      submissionId: submitted.id,
      registrationStatus: 'ACTIVE',
      expiresAt: inYears(1),
    });

    expect(done.status).toBe(200);
    const row = await rowOf(submitted.id);
    expect(row.status).toBe('VERIFIED');
    expect(row.documentExpiresOn?.toISOString().slice(0, 10)).toBe(inYears(1));
    expect(row.expiresAt?.toISOString()).toBe(`${inYears(1)}T23:00:00.000Z`);
  });

  it('refuses a licence that has already expired, before recording anything', async () => {
    const { practitioner, submitted } = await licence();

    const done = await confirmRegistration({
      submissionId: submitted.id,
      registrationStatus: 'ACTIVE',
      expiresAt: '2020-01-31',
    });

    expect(done.status).toBe(422);
    expect((await rowOf(submitted.id)).status).toBe('PENDING');
    expect(await prisma.professionalRegistration.count({ where: { userId: practitioner.id } })).toBe(0);
  });

  it('still lets a suspended licence be recorded and rejected whatever its date says', async () => {
    const { submitted } = await licence();

    const done = await confirmRegistration({
      submissionId: submitted.id,
      registrationStatus: 'SUSPENDED',
      expiresAt: '2020-01-31',
    });

    expect(done.status).toBe(200);
    expect((await rowOf(submitted.id)).status).toBe('REJECTED');
  });
});
