import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

// Only headObject touches the network; getSignedUrl (inside createUploadUrl)
// is a local signing computation and stays real, same as the rest of the
// upload flow.
vi.mock('@/lib/storage/tigris', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/tigris')>();
  return { ...actual, headObject: vi.fn().mockResolvedValue({}) };
});

import { prisma } from '@/lib/db';
import { GET, PATCH, POST } from '@/app/api/v1/practitioners/me/route';
import { POST as requestPhotoUploadUrl } from '@/app/api/v1/practitioners/me/photo-upload-url/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import {
  createProfessionalCategory,
  createSpecialty,
  createUser,
  grant,
} from './support/fixtures';

/**
 * Stage 5.1 — the caller's own practitioner profile, guarded by the same
 * permission+scope machinery as everything else (Stage 4.3/4.4), scoped
 * strictly to SELF.
 */

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

async function callGet(): Promise<ApiResult> {
  const response = await GET(new Request('http://localhost/api/v1/practitioners/me'));
  return { status: response.status, body: await response.json() };
}

async function callPost(body: unknown): Promise<ApiResult> {
  const response = await POST(
    new Request('http://localhost/api/v1/practitioners/me', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function callPatch(body: unknown): Promise<ApiResult> {
  const response = await PATCH(
    new Request('http://localhost/api/v1/practitioners/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function callPhotoUploadUrl(body: unknown): Promise<ApiResult> {
  const response = await requestPhotoUploadUrl(
    new Request('http://localhost/api/v1/practitioners/me/photo-upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

async function loginAsPractitioner() {
  const user = await createUser();
  await grant({
    userId: user.id,
    roleKey: 'practitioner',
    permissions: ['practitioner.profile.read', 'practitioner.profile.write'],
    scopeType: 'SELF',
    scopeId: user.id,
  });
  await issueSession({ userId: user.id });
  return user;
}

beforeEach(() => {
  clearCookies();
});

describe('a caller without a session', () => {
  it('is told to sign in on every action', async () => {
    expect((await callGet()).status).toBe(401);
    expect((await callPost({})).status).toBe(401);
    expect((await callPatch({})).status).toBe(401);
    expect((await callPhotoUploadUrl({})).status).toBe(401);
  });
});

describe('a session with no grant', () => {
  it('is refused with 403', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });

    expect((await callGet()).status).toBe(403);
  });

  it('is refused even holding an unrelated permission', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'compliance_officer',
      permissions: ['audit.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: user.id });

    expect((await callGet()).status).toBe(403);
  });
});

describe('the profile journey', () => {
  it('has no profile until POST creates one, and refuses a second POST', async () => {
    const user = await loginAsPractitioner();
    const category = await createProfessionalCategory();

    const before = await callGet();
    expect(before.status).toBe(404);
    expect(before.body).toMatchObject({ error: { code: 'profile_not_found' } });

    const created = await callPost({
      professionalCategoryId: category.id,
      yearsOfExperience: 5,
      bio: 'Ten years in emergency medicine.',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      userId: user.id,
      professionalCategoryId: category.id,
      yearsOfExperience: 5,
    });

    const after = await callGet();
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ userId: user.id, yearsOfExperience: 5 });

    const secondPost = await callPost({ professionalCategoryId: category.id, yearsOfExperience: 1 });
    expect(secondPost.status).toBe(409);
    expect(secondPost.body).toMatchObject({ error: { code: 'profile_already_exists' } });

    // The rejected second POST changed nothing.
    expect((await callGet()).body).toMatchObject({ yearsOfExperience: 5 });
  });

  it('shows each caller only their own profile', async () => {
    const category = await createProfessionalCategory();

    const userA = await loginAsPractitioner();
    await callPost({ professionalCategoryId: category.id, yearsOfExperience: 2 });

    clearCookies();
    const userB = await loginAsPractitioner();
    expect((await callGet()).status).toBe(404); // B has no profile, even though A does

    const bCreated = await callPost({ professionalCategoryId: category.id, yearsOfExperience: 9 });
    expect(bCreated.body.userId).toBe(userB.id);
    expect(bCreated.body.userId).not.toBe(userA.id);
  });
});

describe('updating', () => {
  it('changes only the given field', async () => {
    const category = await createProfessionalCategory();
    await loginAsPractitioner();
    await callPost({ professionalCategoryId: category.id, yearsOfExperience: 3, bio: 'Original bio.' });

    const patched = await callPatch({ bio: 'Updated bio.' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ bio: 'Updated bio.', yearsOfExperience: 3 });
  });

  it('clears a nullable field when explicitly set to null', async () => {
    const category = await createProfessionalCategory();
    const specialty = await createSpecialty(category.id);
    await loginAsPractitioner();
    await callPost({
      professionalCategoryId: category.id,
      specialtyId: specialty.id,
      yearsOfExperience: 4,
    });

    const cleared = await callPatch({ specialtyId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.specialtyId).toBeNull();
  });

  it('404s before any profile has been created — PATCH never upserts', async () => {
    await loginAsPractitioner();
    expect((await callPatch({ bio: 'No profile yet.' })).status).toBe(404);
  });
});

describe('validation', () => {
  it('rejects a specialty from a different category', async () => {
    const category = await createProfessionalCategory();
    const otherCategory = await createProfessionalCategory();
    const specialty = await createSpecialty(otherCategory.id);
    await loginAsPractitioner();

    const result = await callPost({
      professionalCategoryId: category.id,
      specialtyId: specialty.id,
      yearsOfExperience: 2,
    });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'invalid_specialty' } });
  });

  it('rejects an unknown professional category rather than crashing', async () => {
    await loginAsPractitioner();
    const result = await callPost({
      professionalCategoryId: '00000000-0000-0000-0000-000000000000',
      yearsOfExperience: 2,
    });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'invalid_professional_category' } });
  });

  it('rejects years of experience outside 0–60', async () => {
    const category = await createProfessionalCategory();
    await loginAsPractitioner();
    expect(
      (await callPost({ professionalCategoryId: category.id, yearsOfExperience: -1 })).status,
    ).toBe(422);
    expect(
      (await callPost({ professionalCategoryId: category.id, yearsOfExperience: 61 })).status,
    ).toBe(422);
  });

  it('accepts the boundary values 0 and 60', async () => {
    const category = await createProfessionalCategory();

    await loginAsPractitioner();
    expect(
      (await callPost({ professionalCategoryId: category.id, yearsOfExperience: 0 })).status,
    ).toBe(201);

    clearCookies();
    await loginAsPractitioner();
    expect(
      (await callPost({ professionalCategoryId: category.id, yearsOfExperience: 60 })).status,
    ).toBe(201);
  });

  it('rejects a bio over 1000 characters', async () => {
    const category = await createProfessionalCategory();
    await loginAsPractitioner();
    const result = await callPost({
      professionalCategoryId: category.id,
      yearsOfExperience: 1,
      bio: 'a'.repeat(1001),
    });
    expect(result.status).toBe(422);
  });
});

describe('the photo-upload flow', () => {
  it('issues an upload URL and records a pending StoredObject row', async () => {
    await loginAsPractitioner();
    const result = await callPhotoUploadUrl({
      filename: 'headshot.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    });

    expect(result.status).toBe(200);
    expect(result.body.objectKey).toBeTruthy();
    expect(result.body.uploadUrl).toBeTruthy();

    const stored = await prisma.storedObject.findUniqueOrThrow({
      where: { objectKey: result.body.objectKey as string },
    });
    expect(stored.purpose).toBe('profile_photograph');
    expect(stored.uploadedAt).toBeNull();
  });

  it('confirms the photo once the profile references it', async () => {
    const category = await createProfessionalCategory();
    const user = await loginAsPractitioner();
    const upload = await callPhotoUploadUrl({
      filename: 'headshot.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    });

    const created = await callPost({
      professionalCategoryId: category.id,
      yearsOfExperience: 2,
      photoObjectKey: upload.body.objectKey,
    });
    expect(created.status).toBe(201);
    expect(created.body.photoObjectKey).toBe(upload.body.objectKey);

    const stored = await prisma.storedObject.findUniqueOrThrow({
      where: { objectKey: upload.body.objectKey as string },
    });
    expect(stored.uploadedAt).not.toBeNull();
    expect(stored.ownerUserId).toBe(user.id);
  });

  it('rejects a photo key owned by someone else', async () => {
    const category = await createProfessionalCategory();
    await loginAsPractitioner();
    const upload = await callPhotoUploadUrl({
      filename: 'headshot.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    });

    clearCookies();
    await loginAsPractitioner();
    const result = await callPost({
      professionalCategoryId: category.id,
      yearsOfExperience: 2,
      photoObjectKey: upload.body.objectKey,
    });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'invalid_photo_reference' } });
  });
});
