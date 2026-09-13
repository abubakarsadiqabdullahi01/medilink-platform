import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import { SUSPENSION_REASON_MIN_LENGTH } from '../domain/incident';

/**
 * Suspending and reinstating an account.
 *
 * `user.suspend` has been in the permission catalogue since Stage 4 with
 * nothing behind it — this is the code. It lives here rather than in `auth`
 * because module 15 is what the specification says suspension is *for*
 * (`incident.manage`: "Manage a clinical incident, including suspension"),
 * and a suspension with no case attached is the exception rather than the
 * rule.
 *
 * The teeth are already built: `SUSPENDED` fails the `account_not_usable`
 * check in the Stage 5 eligibility rule, so a suspended practitioner stops
 * matching immediately, everywhere, with no sweep involved.
 */

export const SuspensionErrors = {
  userNotFound: () => new HttpError('user_not_found', 'That user does not exist.', 404),

  reasonRequired: () =>
    new HttpError(
      'suspension_reason_required',
      'Say why this account is being suspended.',
      422,
    ),

  alreadySuspended: () =>
    new HttpError('already_suspended', 'That account is already suspended.', 409),

  notSuspended: () => new HttpError('not_suspended', 'That account is not suspended.', 409),

  notLiftable: () =>
    new HttpError(
      'suspension_not_liftable',
      'That account was not suspended by a recorded decision, so there is nothing to lift.',
      409,
    ),
};

export interface SuspensionView {
  id: string;
  userId: string;
  reason: string;
  suspendedBy: string;
  suspendedAt: Date;
  incidentId: string | null;
  liftedBy: string | null;
  liftedAt: Date | null;
  liftedReason: string | null;
}

function toView(row: SuspensionView): SuspensionView {
  return {
    id: row.id,
    userId: row.userId,
    reason: row.reason,
    suspendedBy: row.suspendedBy,
    suspendedAt: row.suspendedAt,
    incidentId: row.incidentId,
    liftedBy: row.liftedBy,
    liftedAt: row.liftedAt,
    liftedReason: row.liftedReason,
  };
}

export interface SuspendParams {
  userId: string;
  actorId: string;
  reason: string;
  /** The case that caused it, when there is one. */
  incidentId?: string;
  /** Reuses the caller's transaction when a closure is suspending inline. */
  tx?: Tx;
}

/**
 * Suspends an account, recording who and why.
 *
 * The user row says what somebody is now; the suspension row says how they
 * got there. A suspension with no recorded reason is one nobody can lift with
 * any confidence, which is how people stay suspended by accident.
 */
export async function suspendAccount(input: SuspendParams): Promise<SuspensionView> {
  if ((input.reason ?? '').trim().length < SUSPENSION_REASON_MIN_LENGTH) {
    throw SuspensionErrors.reasonRequired();
  }

  const run = async (tx: Tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw SuspensionErrors.userNotFound();
    if (user.status === 'SUSPENDED') throw SuspensionErrors.alreadySuspended();

    const applied = await tx.user.updateMany({
      where: { id: input.userId, status: { not: 'SUSPENDED' } },
      data: { status: 'SUSPENDED' },
    });
    if (applied.count !== 1) throw SuspensionErrors.alreadySuspended();

    const row = await tx.accountSuspension.create({
      data: {
        userId: input.userId,
        reason: input.reason,
        suspendedBy: input.actorId,
        incidentId: input.incidentId,
      },
    });

    await recordAudit(tx, {
      action: 'user.suspended',
      entityType: 'identity.users',
      entityId: input.userId,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.userId,
      reason: input.reason,
      before: { status: user.status },
      after: { status: 'SUSPENDED', suspensionId: row.id, incidentId: input.incidentId ?? null },
    });

    return toView(row);
  };

  return input.tx ? run(input.tx) : prisma.$transaction(run);
}

export interface ReinstateParams {
  userId: string;
  actorId: string;
  reason: string;
}

/**
 * Lifts a suspension and puts the account back to `ACTIVE`.
 *
 * Reinstating is as much a decision as suspending, and carries its own
 * mandatory reason. The suspension row is not deleted — it is closed, with
 * who lifted it and why, so the account's history reads as a sequence of
 * decisions rather than a status that changed by itself.
 *
 * **Back to `ACTIVE`, not to whatever it was before.** A practitioner
 * suspended out of `UNDER_REVIEW` has, by the time anyone lifts it, been
 * looked at rather harder than the review would have managed; and the Stage 5
 * activation sweep will re-check every eligibility rule on its next pass
 * regardless. Restoring a stale earlier status would be reinstating the
 * paperwork rather than the person.
 */
export async function reinstateAccount(input: ReinstateParams): Promise<SuspensionView> {
  if ((input.reason ?? '').trim().length < SUSPENSION_REASON_MIN_LENGTH) {
    throw SuspensionErrors.reasonRequired();
  }

  return prisma.$transaction(async (tx: Tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw SuspensionErrors.userNotFound();
    if (user.status !== 'SUSPENDED') throw SuspensionErrors.notSuspended();

    const open = await tx.accountSuspension.findFirst({
      where: { userId: input.userId, liftedAt: null },
      orderBy: { suspendedAt: 'desc' },
    });
    if (!open) throw SuspensionErrors.notLiftable();

    const now = new Date();
    const applied = await tx.accountSuspension.updateMany({
      where: { id: open.id, liftedAt: null },
      data: { liftedAt: now, liftedBy: input.actorId, liftedReason: input.reason },
    });
    if (applied.count !== 1) throw SuspensionErrors.notSuspended();

    await tx.user.update({ where: { id: input.userId }, data: { status: 'ACTIVE' } });

    const row = await tx.accountSuspension.findUniqueOrThrow({ where: { id: open.id } });

    await recordAudit(tx, {
      action: 'user.reinstated',
      entityType: 'identity.users',
      entityId: input.userId,
      actorId: input.actorId,
      scopeType: 'SELF',
      scopeId: input.userId,
      reason: input.reason,
      before: { status: 'SUSPENDED', suspensionId: open.id },
      after: { status: 'ACTIVE' },
    });

    return toView(row);
  });
}

/** Every suspension this account has had, newest first. Lifted ones included. */
export async function suspensionHistory(userId: string): Promise<SuspensionView[]> {
  const rows = await prisma.accountSuspension.findMany({
    where: { userId },
    orderBy: { suspendedAt: 'desc' },
  });
  return rows.map(toView);
}

/** The one in force, if any. */
export async function currentSuspension(userId: string): Promise<SuspensionView | null> {
  const row = await prisma.accountSuspension.findFirst({
    where: { userId, liftedAt: null },
    orderBy: { suspendedAt: 'desc' },
  });
  return row ? toView(row) : null;
}
