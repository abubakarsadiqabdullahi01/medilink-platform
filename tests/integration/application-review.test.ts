import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { GET } from '@/app/api/v1/practitioners/me/route';
import { POST } from '@/app/api/v1/practitioners/me/submit/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { createProfile } from '@/modules/practitioners/application/profile';
import { addSlot } from '@/modules/availability/application/availability';
import { reviewCredential, submitCredential } from '@/modules/credentials/application/submission';
import { listPractitioners } from '@/modules/practitioners/application/directory';
import { clearCookies } from './support/cookie-jar';
import {
  createCredentialRequirement,
  createCredentialType,
  createProfessionalCategory,
  createUser,
  grant,
} from './support/fixtures';

/**
 * "I am done — review me": the one act that puts a practitioner in the
 * compliance officer's queue.
 *
 * What is being proved is the refusal as much as the success. The page shows a
 * checklist and disables its button until it is ticked, but the page is a
 * courtesy; an application half-finished by somebody calling the API directly
 * must not reach an officer looking complete.
 */

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

async function submit(): Promise<ApiResult> {
  const response = await POST(
    new Request('http://localhost/api/v1/practitioners/me/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function readProfile(): Promise<ApiResult> {
  const response = await GET(new Request('http://localhost/api/v1/practitioners/me'));
  return { status: response.status, body: await response.json() };
}

const REVIEWER = '00000000-0000-0000-0000-0000000000aa';

/** A practitioner, signed in, in a profession that requires one document. */
async function newcomer(
  options: { profile?: boolean; slot?: boolean; document?: 'PENDING' | 'REJECTED' | null } = {},
) {
  const { profile = true, slot = true, document = 'PENDING' } = options;

  const category = await createProfessionalCategory();
  const credentialType = await createCredentialType({ verificationMethod: 'nimc_verification' });
  await createCredentialRequirement({
    professionalCategoryId: category.id,
    credentialTypeId: credentialType.id,
  });

  const user = await createUser({ status: 'UNDER_REVIEW' });
  await grant({
    userId: user.id,
    roleKey: 'practitioner',
    permissions: ['practitioner.profile.read', 'practitioner.profile.write'],
    scopeType: 'SELF',
    scopeId: user.id,
  });
  await issueSession({ userId: user.id });

  if (profile) {
    await createProfile({
      userId: user.id,
      professionalCategoryId: category.id,
      yearsOfExperience: 2,
    });
  }
  if (slot) {
    await addSlot({
      userId: user.id,
      kind: 'RECURRING_WEEKLY',
      dayOfWeek: 1,
      startMinute: 8 * 60,
      endMinute: 16 * 60,
    });
  }
  if (document) {
    const submitted = await submitCredential({
      userId: user.id,
      credentialTypeId: credentialType.id,
      referenceNumber: 'A123456789',
    });
    if (document === 'REJECTED') {
      await reviewCredential({
        submissionId: submitted.id,
        reviewerId: REVIEWER,
        decision: 'reject',
        reviewNotes: 'Not legible.',
      });
    }
  }

  return { user, category };
}

beforeEach(() => {
  clearCookies();
});

describe('who may submit', () => {
  it('is told to sign in without a session', async () => {
    expect((await submit()).status).toBe(401);
  });

  it('is refused without the permission to write a profile', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'practitioner_readonly',
      permissions: ['practitioner.profile.read'],
      scopeType: 'SELF',
      scopeId: user.id,
    });
    await issueSession({ userId: user.id });

    expect((await submit()).status).toBe(403);
  });

  it('only ever acts on the caller’s own application', async () => {
    // The route names no user: the scope is always the caller's own id. So an
    // officer holding the permission platform-wide is submitting *their own*
    // (empty) application, and cannot touch anybody else's — which is a
    // statement only its owner makes.
    const { user: practitioner } = await newcomer();

    clearCookies();
    const officer = await createUser();
    await grant({
      userId: officer.id,
      roleKey: 'operations_officer_probe',
      permissions: ['practitioner.profile.write'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: officer.id });

    expect((await submit()).status).toBe(422);
    const untouched = await prisma.practitionerProfile.findUniqueOrThrow({
      where: { userId: practitioner.id },
    });
    expect(untouched.submittedForReviewAt).toBeNull();
  });
});

describe('an incomplete application', () => {
  it('is refused before there is a profile, naming what is missing', async () => {
    await newcomer({ profile: false, slot: false, document: null });

    const refused = await submit();
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: { code: 'application_incomplete' } });
    expect(JSON.stringify(refused.body)).toContain('your details');
  });

  it('is refused with a profile but no availability', async () => {
    await newcomer({ slot: false });

    const refused = await submit();
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('when you can work');
  });

  it('is refused while a required document has not been supplied', async () => {
    await newcomer({ document: null });

    const refused = await submit();
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('your documents');
  });

  it('is not rescued by a document the reviewer has rejected', async () => {
    // A rejected credential is closed: it is not a document "supplied", so the
    // practitioner has to send a corrected one before there is anything to review.
    await newcomer({ document: 'REJECTED' });

    expect((await submit()).status).toBe(422);
  });

  it('records nothing when it refuses', async () => {
    const { user } = await newcomer({ slot: false });
    await submit();

    const profile = await prisma.practitionerProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.submittedForReviewAt).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { action: 'practitioner.submitted_for_review' } }),
    ).toBe(0);
  });
});

describe('a complete application', () => {
  it('is accepted, stamped, and audited once', async () => {
    const { user } = await newcomer();

    const accepted = await submit();
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ alreadySubmitted: false });

    const profile = await prisma.practitionerProfile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profile.submittedForReviewAt).not.toBeNull();

    const audit = await prisma.auditLog.findMany({
      where: { action: 'practitioner.submitted_for_review', actorId: user.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityType: 'practitioners.practitioner_profiles',
      entityId: profile.id,
      scopeType: 'SELF',
    });
  });

  it('counts a document still waiting for review: supplying is theirs, judging is the officer’s', async () => {
    await newcomer({ document: 'PENDING' });
    expect((await submit()).status).toBe(200);
  });

  it('is idempotent: a second press moves nothing and records nothing', async () => {
    const { user } = await newcomer();

    const first = await submit();
    const second = await submit();

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ alreadySubmitted: true });
    // The timestamp orders the officer's queue, so a retry must not reorder it.
    expect(second.body.submittedForReviewAt).toBe(first.body.submittedForReviewAt);
    expect(
      await prisma.auditLog.count({
        where: { action: 'practitioner.submitted_for_review', actorId: user.id },
      }),
    ).toBe(1);
  });

  it('shows on their own profile, which is how the page tells waiting from draft', async () => {
    await newcomer();
    expect((await readProfile()).body.submittedForReviewAt).toBeNull();

    await submit();
    expect((await readProfile()).body.submittedForReviewAt).not.toBeNull();
  });

  it('survives them editing the profile afterwards', async () => {
    await newcomer();
    await submit();

    const response = await (
      await import('@/app/api/v1/practitioners/me/route')
    ).PATCH(
      new Request('http://localhost/api/v1/practitioners/me', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ yearsOfExperience: 4 }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await readProfile()).body.submittedForReviewAt).not.toBeNull();
  });
});

describe('the officer’s queue', () => {
  it('can be narrowed to those waiting, and to those who have not submitted', async () => {
    const { user: waiting } = await newcomer();
    await submit();

    clearCookies();
    const { user: draft } = await newcomer({ slot: false });

    const waitingPage = await listPractitioners({ limit: 50, application: 'waiting' });
    const draftPage = await listPractitioners({ limit: 50, application: 'draft' });

    expect(waitingPage.practitioners.map((row) => row.userId)).toContain(waiting.id);
    expect(waitingPage.practitioners.map((row) => row.userId)).not.toContain(draft.id);
    expect(draftPage.practitioners.map((row) => row.userId)).toContain(draft.id);
    expect(draftPage.practitioners.map((row) => row.userId)).not.toContain(waiting.id);

    const entry = waitingPage.practitioners.find((row) => row.userId === waiting.id);
    expect(entry?.submittedForReviewAt).not.toBeNull();
  });

  it('puts the longest-waiting first, since that is who has been left longest', async () => {
    const { user: first } = await newcomer();
    await submit();
    clearCookies();
    const { user: second } = await newcomer();
    await submit();

    const page = await listPractitioners({ limit: 50, application: 'waiting' });
    const ids = page.practitioners.map((row) => row.userId);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
  });
});

describe('a refusal sends the application back', () => {
  async function submittedApplication() {
    const { user, category } = await newcomer();
    expect((await submit()).status).toBe(200);
    const submission = await prisma.credentialSubmission.findFirstOrThrow({ where: { userId: user.id } });
    return { user, category, submission };
  }

  const submittedAt = async (userId: string) =>
    (await prisma.practitionerProfile.findUniqueOrThrow({ where: { userId } })).submittedForReviewAt;

  it('takes a refused required document out of "waiting", and says who and why', async () => {
    const { user, submission } = await submittedApplication();
    expect(await submittedAt(user.id)).not.toBeNull();

    await reviewCredential({
      submissionId: submission.id,
      reviewerId: REVIEWER,
      decision: 'reject',
      reviewNotes: 'The slip is cut off at the edge; the number is not fully visible.',
    });

    expect(await submittedAt(user.id)).toBeNull();
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'practitioner.returned_for_changes', scopeId: user.id },
    });
    expect(row.actorId).toBe(REVIEWER);
    expect(row.reason).toContain('cut off');
  });

  it('will not let them submit again on the refused document alone', async () => {
    const { submission } = await submittedApplication();
    await reviewCredential({ submissionId: submission.id, reviewerId: REVIEWER, decision: 'reject', reviewNotes: 'Not legible.' });

    const again = await submit();
    expect(again.status).toBe(422);
  });

  it('lets them back in front of an officer only after a replacement and a fresh submit', async () => {
    const { user, submission } = await submittedApplication();
    await reviewCredential({ submissionId: submission.id, reviewerId: REVIEWER, decision: 'reject', reviewNotes: 'Not legible.' });

    await submitCredential({
      userId: user.id,
      credentialTypeId: submission.credentialTypeId,
      referenceNumber: 'A123456789',
    });
    // The replacement alone does not put them back in the queue.
    expect(await submittedAt(user.id)).toBeNull();

    expect((await submit()).status).toBe(200);
    expect(await submittedAt(user.id)).not.toBeNull();
  });

  it('does not send the application back for an optional document', async () => {
    const { user } = await submittedApplication();
    // Checked by number so it needs no file; and not required of this profession.
    const optional = await createCredentialType({ verificationMethod: 'nimc_verification' });
    const extra = await submitCredential({
      userId: user.id,
      credentialTypeId: optional.id,
      referenceNumber: 'B987654321',
    });

    await reviewCredential({ submissionId: extra.id, reviewerId: REVIEWER, decision: 'reject', reviewNotes: 'Expired.' });
    expect(await submittedAt(user.id)).not.toBeNull();
  });
});
