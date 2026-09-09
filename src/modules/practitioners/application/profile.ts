import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { createUploadUrl, headObject } from '@/lib/storage/tigris';
import { isSpecialtyValidForCategory } from '../domain/profile';
import { PractitionerErrors } from '../domain/errors';

/**
 * The practitioner-profile aggregate: create, read and update the caller's
 * own profile, and the photo-upload flow that feeds it. One file, matching
 * auth/application/registration.ts's precedent of grouping one aggregate's
 * operations together.
 */

export interface PractitionerProfileView {
  id: string;
  userId: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  yearsOfExperience: number;
  bio: string | null;
  photoObjectKey: string | null;
  homeStateId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toView(profile: {
  id: string;
  userId: string;
  professionalCategoryId: string;
  specialtyId: string | null;
  yearsOfExperience: number;
  bio: string | null;
  photoObjectKey: string | null;
  homeStateId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PractitionerProfileView {
  return {
    id: profile.id,
    userId: profile.userId,
    professionalCategoryId: profile.professionalCategoryId,
    specialtyId: profile.specialtyId,
    yearsOfExperience: profile.yearsOfExperience,
    bio: profile.bio,
    photoObjectKey: profile.photoObjectKey,
    homeStateId: profile.homeStateId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

async function assertCategoryAndSpecialty(
  professionalCategoryId: string,
  specialtyId: string | null,
): Promise<void> {
  const category = await prisma.professionalCategory.findUnique({
    where: { id: professionalCategoryId },
    select: { isActive: true },
  });
  if (!category || !category.isActive) throw PractitionerErrors.invalidCategory();

  if (specialtyId) {
    const specialty = await prisma.specialty.findUnique({
      where: { id: specialtyId },
      select: { categoryId: true, isActive: true },
    });
    if (
      !specialty ||
      !specialty.isActive ||
      !isSpecialtyValidForCategory(specialty, professionalCategoryId)
    ) {
      throw PractitionerErrors.invalidSpecialty();
    }
  }
}

async function assertState(homeStateId: string | null): Promise<void> {
  if (!homeStateId) return;
  const state = await prisma.state.findUnique({ where: { id: homeStateId }, select: { id: true } });
  if (!state) throw PractitionerErrors.invalidState();
}

/**
 * Confirms the client actually finished uploading before the profile is
 * allowed to reference the object — a network call, so it stays outside any
 * transaction, same reasoning as "codes are sent after the transaction
 * commits" in the auth module.
 */
async function confirmPhotoOwnership(userId: string, objectKey: string): Promise<void> {
  const stored = await prisma.storedObject.findUnique({ where: { objectKey } });
  if (!stored || stored.ownerUserId !== userId || stored.purpose !== 'profile_photograph' || stored.deletedAt) {
    throw PractitionerErrors.invalidPhotoReference();
  }
  try {
    await headObject(objectKey);
  } catch {
    throw PractitionerErrors.invalidPhotoReference();
  }
}

/**
 * Marks the StoredObject uploaded, with its own audit row — separate from
 * the profile's own row, and separate from the upload-url request's row.
 * Unlike an OTP's issue-then-consume pair, this confirmation can happen in a
 * later, unrelated request, so relying on a nearby row to cover it would be
 * fragile rather than merely imprecise.
 */
async function confirmPhotoUpload(tx: Tx, userId: string, objectKey: string): Promise<void> {
  const updated = await tx.storedObject.update({
    where: { objectKey },
    data: { uploadedAt: new Date() },
  });

  await recordAudit(tx, {
    action: 'practitioner.photo_confirmed',
    entityType: 'storage.stored_objects',
    entityId: updated.id,
    actorId: userId,
    scopeType: 'SELF',
    scopeId: userId,
  });
}

export interface CreateProfileParams {
  userId: string;
  professionalCategoryId: string;
  specialtyId?: string;
  yearsOfExperience: number;
  bio?: string;
  homeStateId?: string;
  photoObjectKey?: string;
}

export async function createProfile(input: CreateProfileParams): Promise<PractitionerProfileView> {
  const existing = await prisma.practitionerProfile.findUnique({ where: { userId: input.userId } });
  if (existing && !existing.deletedAt) throw PractitionerErrors.profileAlreadyExists();

  await assertCategoryAndSpecialty(input.professionalCategoryId, input.specialtyId ?? null);
  await assertState(input.homeStateId ?? null);
  if (input.photoObjectKey) await confirmPhotoOwnership(input.userId, input.photoObjectKey);

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.practitionerProfile.create({
        data: {
          userId: input.userId,
          professionalCategoryId: input.professionalCategoryId,
          specialtyId: input.specialtyId,
          yearsOfExperience: input.yearsOfExperience,
          bio: input.bio,
          homeStateId: input.homeStateId,
          photoObjectKey: input.photoObjectKey,
        },
      });

      if (input.photoObjectKey) {
        await confirmPhotoUpload(tx, input.userId, input.photoObjectKey);
      }

      await recordAudit(tx, {
        action: 'practitioner.profile_created',
        entityType: 'practitioners.practitioner_profiles',
        entityId: created.id,
        actorId: input.userId,
        scopeType: 'SELF',
        scopeId: input.userId,
        after: toView(created),
      });

      return toView(created);
    });
  } catch (error) {
    // A concurrent double-submit racing past the pre-check above.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw PractitionerErrors.profileAlreadyExists();
    }
    throw error;
  }
}

export async function getOwnProfile(userId: string): Promise<PractitionerProfileView> {
  const profile = await prisma.practitionerProfile.findUnique({ where: { userId } });
  if (!profile || profile.deletedAt) throw PractitionerErrors.profileNotFound();
  return toView(profile);
}

export interface UpdateProfileParams {
  userId: string;
  professionalCategoryId?: string;
  specialtyId?: string | null;
  yearsOfExperience?: number;
  bio?: string | null;
  homeStateId?: string | null;
  photoObjectKey?: string | null;
}

/** Partial update only. Never upserts — PATCH before any POST is 404. */
export async function updateProfile(input: UpdateProfileParams): Promise<PractitionerProfileView> {
  const existing = await prisma.practitionerProfile.findUnique({ where: { userId: input.userId } });
  if (!existing || existing.deletedAt) throw PractitionerErrors.profileNotFound();

  // Re-validate the category/specialty pair whenever either is present in
  // the request, resolved against the other field's current-or-new value —
  // changing only the category must still be checked against the existing
  // specialty, and vice versa.
  if (input.professionalCategoryId !== undefined || input.specialtyId !== undefined) {
    const nextCategoryId = input.professionalCategoryId ?? existing.professionalCategoryId;
    const nextSpecialtyId = input.specialtyId === undefined ? existing.specialtyId : input.specialtyId;
    await assertCategoryAndSpecialty(nextCategoryId, nextSpecialtyId);
  }

  if (input.homeStateId !== undefined) await assertState(input.homeStateId);
  if (input.photoObjectKey) await confirmPhotoOwnership(input.userId, input.photoObjectKey);

  return prisma.$transaction(async (tx) => {
    // Prisma skips a field left `undefined` and sets one passed `null` —
    // exactly "leave unchanged" versus "clear it".
    const updated = await tx.practitionerProfile.update({
      where: { userId: input.userId },
      data: {
        professionalCategoryId: input.professionalCategoryId,
        specialtyId: input.specialtyId,
        yearsOfExperience: input.yearsOfExperience,
        bio: input.bio,
        homeStateId: input.homeStateId,
        photoObjectKey: input.photoObjectKey,
      },
    });

    if (input.photoObjectKey) {
      await confirmPhotoUpload(tx, input.userId, input.photoObjectKey);
    }

    await recordAudit(tx, {
      action: 'practitioner.profile_updated',
      entityType: 'practitioners.practitioner_profiles',
      entityId: updated.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      before: toView(existing),
      after: toView(updated),
    });

    return toView(updated);
  });
}

export interface RequestPhotoUploadUrlParams {
  userId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface PhotoUploadUrl {
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

/**
 * Issues a signed upload URL and records the StoredObject row eagerly, with
 * `uploadedAt` left null. The row is only trusted once createProfile or
 * updateProfile confirms the upload actually landed.
 */
export async function requestPhotoUploadUrl(
  input: RequestPhotoUploadUrlParams,
): Promise<PhotoUploadUrl> {
  const { objectKey, url, expiresInSeconds } = await createUploadUrl({
    purpose: 'profile_photograph',
    ownerId: input.userId,
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  await prisma.$transaction(async (tx) => {
    const stored = await tx.storedObject.create({
      data: {
        bucket: env.STORAGE_BUCKET,
        objectKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        purpose: 'profile_photograph',
        ownerUserId: input.userId,
        scopeType: 'SELF',
        scopeId: input.userId,
      },
    });

    await recordAudit(tx, {
      action: 'practitioner.photo_upload_requested',
      entityType: 'storage.stored_objects',
      entityId: stored.id,
      actorId: input.userId,
      scopeType: 'SELF',
      scopeId: input.userId,
      after: { objectKey, contentType: input.contentType, sizeBytes: input.sizeBytes },
    });
  });

  return { objectKey, uploadUrl: url, expiresInSeconds };
}
