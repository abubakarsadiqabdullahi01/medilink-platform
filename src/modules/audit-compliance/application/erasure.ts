import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { deleteObject } from '@/lib/storage/tigris';
import { assessErasure } from './data-subject';
import {
  ERASED_NAME,
  ERASURE_RETAINED,
  erasedFolio,
  erasedPhone,
  erasureOutcome,
  type ErasureReport,
} from '../domain/erasure';

/**
 * Carrying out an erasure request (AUD-01).
 *
 * Until this existed the page and the API assessed blockers and explained, and
 * closing an erasure request recorded words and deleted nothing: no code replaced
 * a name, deleted a file or closed the account.
 *
 * What is replaced, deleted and kept is the schedule in ../domain/erasure.ts. In
 * one transaction the person's identifying details are replaced, their sign-ins
 * ended, what they wrote or was sent to them deleted, the account closed and the
 * request completed; the files are deleted from storage straight afterwards. The
 * transaction does not wait on storage, so a bucket that is down cannot hold
 * the database change hostage - and the change cannot be left half-made by one
 * that fails.
 */

export const ErasureErrors = {
  requestNotFound: () => new HttpError('request_not_found', 'That request does not exist.', 404),
  notAnErasure: () =>
    new HttpError('not_an_erasure_request', 'That request is not a request for erasure.', 409),
  notStarted: () =>
    new HttpError(
      'request_not_started',
      'Pick the request up first, so there is a record of who is dealing with it.',
      409,
    ),
  blocked: (codes: string[]) =>
    new HttpError(
      'erasure_blocked',
      `This cannot go ahead yet: ${codes.join(', ')}. Each is something to settle first.`,
      409,
    ),
  staffAccount: () =>
    new HttpError(
      'erasure_staff_account',
      'This account works for a facility or for the platform. Erasing it is not something this can do; hand the facility its staff first.',
      409,
    ),
  refused: () =>
    new HttpError('request_refused', 'That request was refused, so there is nothing to erase.', 409),
};

const SUGGESTION_REMOVED = '[Removed at the author\'s request.]';

/** Whether this account is anything but a practitioner's own: erased with a facility's or the platform's records attached, it would orphan them. */
async function worksForAnOrganisation(tx: Tx, userId: string): Promise<boolean> {
  const [grants, represented] = await Promise.all([
    tx.userRole.count({ where: { userId, revokedAt: null, scopeType: { not: 'SELF' } } }),
    tx.facility.count({ where: { representativeUserId: userId } }),
  ]);
  return grants > 0 || represented > 0;
}

/**
 * Erases the person a request is about. Re-runnable: a request already
 * completed only finishes whatever files were left, so a storage failure is
 * mended by pressing the button again.
 */
export async function executeErasure(input: {
  requestId: string;
  actorId: string;
}): Promise<ErasureReport> {
  const done = await prisma.$transaction(async (tx: Tx) => {
    // Locked first, so two officers pressing together take turns and the second
    // finds it done.
    await tx.$executeRaw`SELECT 1 FROM consent.data_subject_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`;
    const request = await tx.dataSubjectRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw ErasureErrors.requestNotFound();
    if (request.kind !== 'ERASURE') throw ErasureErrors.notAnErasure();
    if (request.status === 'REFUSED') throw ErasureErrors.refused();
    if (request.status === 'RECEIVED') throw ErasureErrors.notStarted();
    if (request.status === 'COMPLETED') return { userId: request.userId, finished: true as const };

    const user = await tx.user.findUniqueOrThrow({ where: { id: request.userId } });

    const assessment = await assessErasure(user.id, tx);
    if (!assessment.canProceed) {
      throw ErasureErrors.blocked(assessment.blockers.map((blocker) => blocker.code));
    }
    if (await worksForAnOrganisation(tx, user.id)) throw ErasureErrors.staffAccount();

    const now = new Date();
    const replaced: Record<string, number> = {};
    const deleted: Record<string, number> = {};
    const count = (target: Record<string, number>, kind: string, n: number) => {
      if (n > 0) target[kind] = n;
    };

    // --- Files: named now, deleted after the commit. A row exists for every one,
    // so a failure leaves something to retry from.
    const [owned, profile, credentials] = await Promise.all([
      tx.storedObject.findMany({ where: { ownerUserId: user.id, deletedAt: null } }),
      tx.practitionerProfile.findUnique({ where: { userId: user.id } }),
      tx.credentialSubmission.findMany({ where: { userId: user.id } }),
    ]);
    const known = new Set(owned.map((row) => row.objectKey));
    const referenced = [
      profile?.photoObjectKey,
      ...credentials.map((row) => row.documentObjectKey),
    ].filter((key): key is string => Boolean(key));
    for (const key of referenced) {
      if (known.has(key)) continue;
      known.add(key);
      await tx.storedObject.create({
        data: {
          bucket: env.STORAGE_BUCKET,
          objectKey: key,
          contentType: 'application/octet-stream',
          sizeBytes: 0,
          purpose: 'erasure-pending',
          ownerUserId: user.id,
        },
      });
    }

    // --- Identity.
    await tx.user.update({
      where: { id: user.id },
      data: {
        fullName: ERASED_NAME,
        email: null,
        phone: erasedPhone(user.id),
        passwordHash: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        status: 'DEACTIVATED',
        deletedAt: now,
      },
    });
    count(replaced, 'account', 1);

    // --- Every way of signing in, and the record of attempts to.
    count(deleted, 'sessions', (await tx.session.deleteMany({ where: { userId: user.id } })).count);
    count(deleted, 'devices', (await tx.device.deleteMany({ where: { userId: user.id } })).count);
    count(deleted, 'one-time codes', (await tx.otpCode.deleteMany({ where: { userId: user.id } })).count);
    count(
      deleted,
      'sign-in attempts',
      (
        await tx.loginAttempt.deleteMany({
          where: {
            OR: [
              { userId: user.id },
              { identifier: user.phone },
              ...(user.email ? [{ identifier: user.email }] : []),
            ],
          },
        })
      ).count,
    );
    count(
      replaced,
      'role grants (ended)',
      (await tx.userRole.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } })).count,
    );

    // --- The professional record.
    count(
      replaced,
      'practitioner profile',
      (
        await tx.practitionerProfile.updateMany({
          where: { userId: user.id },
          data: { bio: null, photoObjectKey: null, homeStateId: null, homeLgaId: null, deletedAt: now },
        })
      ).count,
    );
    count(
      deleted,
      'identity checks',
      (await tx.identityVerification.deleteMany({ where: { userId: user.id } })).count,
    );
    const registrations = await tx.professionalRegistration.findMany({ where: { userId: user.id } });
    for (const registration of registrations) {
      await tx.professionalRegistration.update({
        where: { id: registration.id },
        data: { folioNumber: erasedFolio(registration.id), location: null, practiceType: null, deletedAt: now },
      });
    }
    count(replaced, 'professional registrations', registrations.length);
    count(
      replaced,
      'credential submissions',
      (
        await tx.credentialSubmission.updateMany({
          where: { userId: user.id },
          data: { referenceNumber: null, documentObjectKey: null, reviewNotes: null },
        })
      ).count,
    );
    count(
      replaced,
      'screening notes',
      (await tx.screeningResult.updateMany({ where: { userId: user.id }, data: { notes: null } })).count,
    );

    // --- What they agreed to survives; what they wrote alongside it does not.
    count(
      replaced,
      'consent notes',
      (await tx.consentRecord.updateMany({ where: { userId: user.id, note: { not: null } }, data: { note: null } })).count,
    );
    count(
      replaced,
      'agreement acceptances',
      (
        await tx.agreementAcceptance.updateMany({
          where: { userId: user.id },
          data: { ipAddress: null, userAgent: null },
        })
      ).count,
    );
    count(
      replaced,
      'requests (their words)',
      (await tx.dataSubjectRequest.updateMany({ where: { userId: user.id }, data: { detail: null } })).count,
    );

    // --- What they wrote, and what was sent to them.
    count(deleted, 'notification messages', (await tx.notificationMessage.deleteMany({ where: { userId: user.id } })).count);
    count(deleted, 'blocked periods', (await tx.blockedPeriod.deleteMany({ where: { userId: user.id } })).count);
    count(deleted, 'availability slots', (await tx.availabilitySlot.deleteMany({ where: { userId: user.id } })).count);
    count(
      replaced,
      'suggestions',
      (
        await tx.suggestion.updateMany({
          where: { raisedBy: user.id },
          data: { raisedBy: null, body: SUGGESTION_REMOVED },
        })
      ).count,
    );
    count(
      replaced,
      'security events',
      (
        await tx.securityEvent.updateMany({
          where: { userId: user.id, detail: { not: Prisma.DbNull } },
          data: { detail: Prisma.DbNull },
        })
      ).count,
    );
    count(
      replaced,
      'offer replies',
      (await tx.invitation.updateMany({ where: { userId: user.id, declineReason: { not: null } }, data: { declineReason: null } })).count,
    );
    count(
      replaced,
      'check-in device labels',
      (await tx.checkInEvent.updateMany({ where: { actorId: user.id, deviceLabel: { not: null } }, data: { deviceLabel: null } })).count,
    );

    const report: ErasureReport = {
      replaced,
      deleted,
      files: { deleted: 0, pending: known.size },
      retained: ERASURE_RETAINED,
    };

    await tx.dataSubjectRequest.update({
      where: { id: request.id },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        handledBy: input.actorId,
        outcome: erasureOutcome(report, now),
      },
    });

    // Who did it and how much - not who it was.
    await recordAudit(tx, {
      action: 'data_subject.erased',
      entityType: 'identity.users',
      entityId: user.id,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: user.id,
      after: { requestId: request.id, replaced, deleted, filesToDelete: known.size },
    });

    return { userId: user.id, finished: false as const, report };
  });

  const files = await deleteStoredFiles(done.userId);

  if (!done.finished) {
    // The outcome was written before the files were tried; say how they went.
    const report: ErasureReport = { ...done.report, files };
    if (files.pending > 0) {
      await prisma.dataSubjectRequest.update({
        where: { id: input.requestId },
        data: { outcome: erasureOutcome(report, new Date()) },
      });
    }
    return report;
  }

  return { replaced: {}, deleted: {}, files, retained: ERASURE_RETAINED };
}

/**
 * Deletes every file still held for this person from storage and marks it so. One
 * that cannot be deleted stays on the list for the next attempt.
 */
async function deleteStoredFiles(userId: string): Promise<{ deleted: number; pending: number }> {
  const objects = await prisma.storedObject.findMany({
    where: { ownerUserId: userId, deletedAt: null },
  });

  let deleted = 0;
  let pending = 0;
  for (const object of objects) {
    try {
      await deleteObject(object.objectKey);
      await prisma.storedObject.updateMany({
        where: { id: object.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      deleted += 1;
    } catch (error) {
      pending += 1;
      logger.error('erasure: a file could not be deleted from storage', {
        objectId: object.id,
        error: String(error),
      });
    }
  }
  return { deleted, pending };
}
