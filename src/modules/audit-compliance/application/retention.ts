import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { deleteObject } from '@/lib/storage/tigris';
import { purgeDaysFor } from '../domain/data-inventory';

/**
 * Deletes the data the inventory says is not worth keeping (AUD-04).
 *
 * Only what `PURGE_RULES` lists, on the periods it states: one-time codes,
 * sessions that have ended, the log of sign-in attempts, queue entries that were
 * delivered, and uploads nobody finished. The rest of what the platform holds is
 * kept, or is removed by an erasure request, and this does not touch it.
 *
 * Safe to run at any time and as often as it is asked: every rule is a
 * condition on age, so a second run finds nothing the first did not take. A run
 * that deleted something writes one audit row with counts; a run that found
 * nothing writes none, so the trail is not filled with a daily line of silence.
 */

export interface PurgeReport {
  /** Rows deleted, by rule key. Absent when nothing was. */
  deleted: Record<string, number>;
  /** Files taken out of storage, and ones that could not be yet and will be tried again. */
  files: { deleted: number; pending: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function cutoff(now: Date, rule: string): Date {
  return new Date(now.getTime() - purgeDaysFor(rule) * DAY_MS);
}

export async function purgeExpiredData(input: { now?: Date } = {}): Promise<PurgeReport> {
  const now = input.now ?? new Date();
  const deleted: Record<string, number> = {};
  const record = (rule: string, count: number) => {
    if (count > 0) deleted[rule] = count;
  };

  record(
    'sign_in_codes',
    (await prisma.otpCode.deleteMany({ where: { createdAt: { lt: cutoff(now, 'sign_in_codes') } } })).count,
  );

  // Ended, not merely old: a session that is still live is somebody signed in.
  const sessionsBefore = cutoff(now, 'sessions');
  record(
    'sessions',
    (
      await prisma.session.deleteMany({
        where: { OR: [{ expiresAt: { lt: sessionsBefore } }, { revokedAt: { lt: sessionsBefore } }] },
      })
    ).count,
  );

  record(
    'sign_in_attempts',
    (await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: cutoff(now, 'sign_in_attempts') } } })).count,
  );

  // Delivered only. A failed or given-up entry is work somebody has to look at
  // however long it has sat, and a pending one has not happened yet.
  record(
    'background_queue',
    (
      await prisma.outboxEvent.deleteMany({
        where: { status: 'PROCESSED', processedAt: { lt: cutoff(now, 'background_queue') } },
      })
    ).count,
  );

  // Ended, not merely old: an invitation still waiting is somebody's to answer. Answered and
  // cancelled ones carry the day they ended; one that ran out unanswered ended on its date.
  const invitationsBefore = cutoff(now, 'staff_invitations');
  record(
    'staff_invitations',
    (
      await prisma.staffInvitation.deleteMany({
        where: {
          OR: [
            { respondedAt: { lt: invitationsBefore } },
            { respondedAt: null, expiresAt: { lt: invitationsBefore } },
          ],
        },
      })
    ).count,
  );

  const files = await deleteAbandonedUploads(now);
  record('abandoned_uploads', files.deleted);

  if (Object.keys(deleted).length > 0 || files.pending > 0) {
    await prisma.$transaction(async (tx) => {
      await recordAudit(tx, {
        action: 'retention.purged',
        entityType: 'audit.retention',
        actorType: 'worker',
        after: { deleted, files },
      });
    });
  }

  return { deleted, files };
}

/**
 * A file somebody asked to upload and never confirmed. The file is deleted
 * first and the row marked after, so one that cannot be deleted is found again
 * on the next run rather than forgotten.
 */
async function deleteAbandonedUploads(now: Date): Promise<PurgeReport['files']> {
  const abandoned = await prisma.storedObject.findMany({
    where: { uploadedAt: null, deletedAt: null, createdAt: { lt: cutoff(now, 'abandoned_uploads') } },
    select: { id: true, objectKey: true },
  });

  let deleted = 0;
  let pending = 0;
  for (const object of abandoned) {
    try {
      await deleteObject(object.objectKey);
      await prisma.storedObject.updateMany({
        where: { id: object.id, deletedAt: null },
        data: { deletedAt: now },
      });
      deleted += 1;
    } catch (error) {
      pending += 1;
      logger.error('retention: an abandoned upload could not be deleted from storage', {
        objectId: object.id,
        error: String(error),
      });
    }
  }
  return { deleted, pending };
}
