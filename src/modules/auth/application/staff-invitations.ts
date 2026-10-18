import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { EVENTS } from '@/lib/events';
import { publishEvent } from '@/lib/outbox';
import { HttpError } from '@/lib/http/errors';
import { isAuthorized, type Grant } from '@/lib/authz/guard';
import { ROLE_PERMISSIONS, type Permission } from '@/lib/authz/permissions';
import { PhoneFormatError, maskPhone, normalizeNigerianPhone } from '@/lib/phone';
import { assertScopeMayAddStaff } from '@/modules/facilities/application/facility';
import {
  WINDOWS,
  effectiveStatus,
  expiryFrom,
  isInvitableRole,
  limitBreached,
  type InvitationStatus,
} from '../domain/staff-invitation';
import { CAN_SIGN_IN, GrantErrors, ensureRole, lockScope } from './grants';

/**
 * Inviting somebody to work for a facility, and their answer (M04-06).
 *
 * Giving a registered person a role over a facility used to need only their phone number and the
 * owner's say-so. The person was not asked, and somebody who had not registered could not be given
 * anything. An invitation puts the person's answer in the middle:
 *
 *  - it is bound to the number the facility typed, not to an account, so it waits for somebody who
 *    registers afterwards and tells nobody anything about whether the number is already known;
 *  - it is answered only by whoever has that number *verified*: knowing a number is not holding it;
 *  - it is a grant only when accepted, and the inviter's authority is checked again at that moment,
 *    so an invitation sent by somebody who has since been removed, demoted or suspended gives
 *    nothing.
 *
 * Every change to who may answer or what a role gives happens under the same per-facility lock as
 * removing and changing staff, so an acceptance cannot slip past the removal of the person who
 * sent it.
 */

export const InvitationErrors = {
  roleNotInvitable: () =>
    new HttpError('role_not_invitable', 'That role cannot be offered by invitation.', 422),
  notFound: () => new HttpError('invitation_not_found', 'That invitation does not exist.', 404),
  closed: () =>
    new HttpError('invitation_closed', 'That invitation has already been answered or cancelled.', 409),
  expired: () =>
    new HttpError(
      'invitation_expired',
      'That invitation has run out. Ask the facility to send another.',
      409,
    ),
  withdrawn: () =>
    new HttpError(
      'invitation_withdrawn',
      'Whoever sent this invitation can no longer give that role, so it has been withdrawn. Ask the facility to send another.',
      409,
    ),
  alreadyInvited: () =>
    new HttpError(
      'already_invited',
      'That number has already been invited to that role and has not answered yet.',
      409,
    ),
  limit: (message: string) => new HttpError('invitation_limit', message, 429),
  invalidPhone: (error: PhoneFormatError) => new HttpError('invalid_phone', error.message, 422),
  facilityNotFound: () => new HttpError('facility_not_found', 'That facility does not exist.', 404),
};

/** What the facility sees of an invitation. The number is masked: they typed it and can recognise it. */
export interface InvitationView {
  id: string;
  facilityId: string;
  phone: string;
  roleKey: string;
  status: InvitationStatus;
  invitedBy: { id: string; fullName: string };
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  /** Whether the text reached the number: `waiting` until the worker has tried. */
  text: 'waiting' | 'sent' | 'failed';
}

/** What the person invited sees. The facility's name and the role, and who asked. */
export interface MyInvitationView {
  id: string;
  facilityId: string;
  facilityName: string;
  roleKey: string;
  invitedByName: string;
  expiresAt: Date;
}

export interface InvitationAnswer {
  invitationId: string;
  decision: 'accepted' | 'declined';
  facilityId: string;
  facilityName: string;
  roleKey: string;
  /** The grant an acceptance gave, or found already there. */
  grantId: string | null;
}

const facilityScope = (facilityId: string) => ({ type: 'FACILITY' as const, id: facilityId });

/** The same list `loadGrants` builds, read inside the transaction that depends on it. */
async function grantsOf(tx: Tx, userId: string): Promise<Grant[]> {
  const rows = await tx.userRole.findMany({
    where: { userId, revokedAt: null },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  return rows.flatMap((row) =>
    row.role.permissions.map((link) => ({
      permission: link.permission.key as Permission,
      scopeType: row.scopeType as Grant['scopeType'],
      scopeId: row.scopeId,
    })),
  );
}

/**
 * Whether this person may give this role at this facility: they hold `role.grant` there, and every
 * permission the role carries, at that facility or the platform.
 *
 * Stricter than the direct grant, which counts a permission held anywhere. An invitation is
 * answered by a stranger days later, so what the inviter can give is held to what they hold *here*.
 */
function mayGive(grants: Grant[], userId: string, facilityId: string, roleKey: string): boolean {
  const scope = facilityScope(facilityId);
  if (!isAuthorized(grants, 'role.grant', scope, userId)) return false;
  return (ROLE_PERMISSIONS[roleKey] ?? []).every((permission) =>
    isAuthorized(grants, permission, scope, userId),
  );
}

function view(
  row: {
    id: string;
    facilityId: string;
    phone: string;
    roleKey: string;
    status: InvitationStatus;
    expiresAt: Date;
    createdAt: Date;
    respondedAt: Date | null;
    smsSentAt: Date | null;
    smsFailureReason: string | null;
    inviter: { id: string; fullName: string };
  },
  now: Date,
): InvitationView {
  return {
    id: row.id,
    facilityId: row.facilityId,
    phone: maskPhone(row.phone),
    roleKey: row.roleKey,
    status: effectiveStatus(row, now),
    invitedBy: { id: row.inviter.id, fullName: row.inviter.fullName },
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
    text: row.smsSentAt ? 'sent' : row.smsFailureReason ? 'failed' : 'waiting',
  };
}

const INVITER = { select: { id: true, fullName: true } } as const;

export async function inviteStaff(input: {
  facilityId: string;
  phone: string;
  roleKey: string;
  actorId: string;
  now?: Date;
}): Promise<InvitationView> {
  const now = input.now ?? new Date();
  if (!isInvitableRole(input.roleKey)) throw InvitationErrors.roleNotInvitable();

  let phone: string;
  try {
    phone = normalizeNigerianPhone(input.phone);
  } catch (error) {
    if (error instanceof PhoneFormatError) throw InvitationErrors.invalidPhone(error);
    throw error;
  }

  const scope = facilityScope(input.facilityId);
  // Where the inviter's authority comes from: a facility may add people only once it is verified,
  // and Medilink may add them to one still being onboarded.
  await assertScopeMayAddStaff(scope, input.actorId);

  return prisma.$transaction(async (tx: Tx) => {
    await lockScope(tx, scope);

    const actorGrants = await grantsOf(tx, input.actorId);
    if (!mayGive(actorGrants, input.actorId, input.facilityId, input.roleKey)) {
      throw GrantErrors.cannotEscalate();
    }

    const facility = await tx.facility.findFirst({
      where: { id: input.facilityId, deletedAt: null },
      select: { id: true },
    });
    if (!facility) throw InvitationErrors.facilityNotFound();

    const alreadyHolds = await tx.userRole.findFirst({
      where: {
        scopeType: 'FACILITY',
        scopeId: input.facilityId,
        revokedAt: null,
        role: { key: input.roleKey },
        user: { phone, deletedAt: null },
      },
      select: { id: true },
    });
    if (alreadyHolds) throw GrantErrors.alreadyGranted();

    // One that has run out stops being "waiting", so a new one can be sent.
    const lapsed = await tx.staffInvitation.findMany({
      where: {
        facilityId: input.facilityId,
        phone,
        roleKey: input.roleKey,
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      select: { id: true },
    });
    for (const old of lapsed) await markExpired(tx, old.id, input.actorId, input.facilityId);

    const waiting = await tx.staffInvitation.findFirst({
      where: { facilityId: input.facilityId, phone, roleKey: input.roleKey, status: 'PENDING' },
      select: { id: true },
    });
    if (waiting) throw InvitationErrors.alreadyInvited();

    const hourAgo = new Date(now.getTime() - WINDOWS.hourMs);
    const dayAgo = new Date(now.getTime() - WINDOWS.dayMs);
    const [inviterLastHour, facilityLastDay, numberLastDay] = await Promise.all([
      tx.staffInvitation.count({ where: { invitedBy: input.actorId, createdAt: { gt: hourAgo } } }),
      tx.staffInvitation.count({ where: { facilityId: input.facilityId, createdAt: { gt: dayAgo } } }),
      tx.staffInvitation.count({ where: { phone, createdAt: { gt: dayAgo } } }),
    ]);
    const breach = limitBreached({ inviterLastHour, facilityLastDay, numberLastDay });
    if (breach) throw InvitationErrors.limit(breach.message);

    let created;
    try {
      created = await tx.staffInvitation.create({
        data: {
          facilityId: input.facilityId,
          phone,
          roleKey: input.roleKey,
          invitedBy: input.actorId,
          expiresAt: expiryFrom(now),
          createdAt: now,
        },
        include: { inviter: INVITER },
      });
    } catch (error) {
      // The database's own one-waiting rule, for anything that got past the check above.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw InvitationErrors.alreadyInvited();
      }
      throw error;
    }

    await recordAudit(tx, {
      action: 'staff_invitation.created',
      entityType: 'identity.staff_invitations',
      entityId: created.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: input.facilityId,
      // The role and the date, never the number: the trail is read by more people than the list is.
      after: { roleKey: input.roleKey, expiresAt: created.expiresAt },
    });

    await publishEvent(tx, {
      eventType: EVENTS.StaffInvited,
      aggregateType: 'identity.staff_invitations',
      aggregateId: created.id,
      payload: { invitationId: created.id, facilityId: input.facilityId },
    });

    return view(created, now);
  });
}

/** Records that a pending invitation has run out, so the table says what the clock already did. */
async function markExpired(tx: Tx, invitationId: string, actorId: string, facilityId: string): Promise<void> {
  await tx.staffInvitation.updateMany({
    where: { id: invitationId, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });
  await recordAudit(tx, {
    action: 'staff_invitation.expired',
    entityType: 'identity.staff_invitations',
    entityId: invitationId,
    actorId,
    scopeType: 'FACILITY',
    scopeId: facilityId,
    before: { status: 'PENDING' },
    after: { status: 'EXPIRED' },
  });
}

/** Every invitation a facility has sent, newest first, with what became of each. */
export async function listStaffInvitations(input: {
  facilityId: string;
  now?: Date;
}): Promise<InvitationView[]> {
  const now = input.now ?? new Date();
  const rows = await prisma.staffInvitation.findMany({
    where: { facilityId: input.facilityId },
    include: { inviter: INVITER },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  return rows.map((row) => view(row, now));
}

/**
 * Withdrawing an invitation that has not been answered. The facility is the one scope it can be
 * done from, and an invitation of another facility is "not found" rather than "forbidden".
 */
export async function cancelStaffInvitation(input: {
  invitationId: string;
  facilityId: string;
  actorId: string;
  now?: Date;
}): Promise<InvitationView> {
  const now = input.now ?? new Date();
  const scope = facilityScope(input.facilityId);

  type Outcome = { kind: 'done'; view: InvitationView } | { kind: 'closed' };
  const outcome = await prisma.$transaction(async (tx: Tx): Promise<Outcome> => {
    await lockScope(tx, scope);

    const row = await tx.staffInvitation.findFirst({
      where: { id: input.invitationId, facilityId: input.facilityId },
      include: { inviter: INVITER },
    });
    if (!row) throw InvitationErrors.notFound();

    if (row.status !== 'PENDING') return { kind: 'closed' };
    if (effectiveStatus(row, now) === 'EXPIRED') {
      await markExpired(tx, row.id, input.actorId, input.facilityId);
      return { kind: 'closed' };
    }

    const cancelled = await tx.staffInvitation.update({
      where: { id: row.id },
      data: { status: 'CANCELLED', respondedAt: now, respondedBy: input.actorId },
      include: { inviter: INVITER },
    });
    await recordAudit(tx, {
      action: 'staff_invitation.cancelled',
      entityType: 'identity.staff_invitations',
      entityId: row.id,
      actorId: input.actorId,
      scopeType: 'FACILITY',
      scopeId: input.facilityId,
      before: { status: 'PENDING' },
      after: { status: 'CANCELLED' },
    });
    return { kind: 'done', view: view(cancelled, now) };
  });

  if (outcome.kind === 'closed') throw InvitationErrors.closed();
  return outcome.view;
}

/** Who is signed in as the holder of their number: an account that can sign in, with the number verified. */
async function holderOfNumber(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, ...CAN_SIGN_IN, phoneVerifiedAt: { not: null } },
    select: { id: true, phone: true },
  });
}

/** The invitations waiting for the number a person has verified, and nobody else's. */
export async function listMyInvitations(input: { userId: string; now?: Date }): Promise<MyInvitationView[]> {
  const now = input.now ?? new Date();
  const user = await holderOfNumber(input.userId);
  if (!user) return [];

  const rows = await prisma.staffInvitation.findMany({
    where: { phone: user.phone, status: 'PENDING', expiresAt: { gt: now }, facility: { deletedAt: null } },
    include: { facility: { select: { name: true } }, inviter: INVITER },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({
    id: row.id,
    facilityId: row.facilityId,
    facilityName: row.facility.name,
    roleKey: row.roleKey,
    invitedByName: row.inviter.fullName,
    expiresAt: row.expiresAt,
  }));
}

/**
 * The answer: accept or decline.
 *
 * Whoever is not the holder of the number is told the invitation does not exist, the same words
 * as for one that never did: nobody learns which facilities have invited which numbers.
 *
 * Accepting is where the authority is checked, not where it was sent: the person who invited must
 * still hold `role.grant` at the facility and everything the role carries, with an account that can
 * sign in, and a facility whose authority is its own must still be verified. If the inviter no
 * longer can, the invitation is withdrawn and nothing is given. If only the facility is unverified
 * for now, the invitation stands until its date, in case it is reinstated.
 */
export async function respondToStaffInvitation(input: {
  invitationId: string;
  userId: string;
  decision: 'accept' | 'decline';
  now?: Date;
}): Promise<InvitationAnswer> {
  const now = input.now ?? new Date();

  const user = await holderOfNumber(input.userId);
  const found = user
    ? await prisma.staffInvitation.findUnique({
        where: { id: input.invitationId },
        select: { id: true, phone: true, facilityId: true },
      })
    : null;
  if (!user || !found || found.phone !== user.phone) throw InvitationErrors.notFound();

  const scope = facilityScope(found.facilityId);

  type Outcome =
    | { kind: 'done'; answer: InvitationAnswer }
    | { kind: 'expired' }
    | { kind: 'withdrawn' };

  const outcome = await prisma.$transaction(async (tx: Tx): Promise<Outcome> => {
    await lockScope(tx, scope);

    // Read again under the lock: what was true a moment ago may have been cancelled since.
    const row = await tx.staffInvitation.findUniqueOrThrow({
      where: { id: found.id },
      include: { facility: { select: { name: true } } },
    });
    const answered = (decision: 'accepted' | 'declined'): InvitationAnswer => ({
      invitationId: row.id,
      decision,
      facilityId: row.facilityId,
      facilityName: row.facility.name,
      roleKey: row.roleKey,
      grantId: decision === 'accepted' ? row.grantId : null,
    });

    // The same answer twice is the same answer, so a double tap or a retried request is harmless.
    if (row.respondedBy === user.id) {
      if (row.status === 'ACCEPTED' && input.decision === 'accept') {
        return { kind: 'done', answer: answered('accepted') };
      }
      if (row.status === 'DECLINED' && input.decision === 'decline') {
        return { kind: 'done', answer: answered('declined') };
      }
    }
    if (row.status === 'ACCEPTED' || row.status === 'DECLINED' || row.status === 'CANCELLED') {
      throw InvitationErrors.closed();
    }
    if (effectiveStatus(row, now) === 'EXPIRED') {
      if (row.status === 'PENDING') await markExpired(tx, row.id, user.id, row.facilityId);
      return { kind: 'expired' };
    }

    if (input.decision === 'decline') {
      await tx.staffInvitation.update({
        where: { id: row.id },
        data: { status: 'DECLINED', respondedAt: now, respondedBy: user.id },
      });
      await recordAudit(tx, {
        action: 'staff_invitation.declined',
        entityType: 'identity.staff_invitations',
        entityId: row.id,
        actorId: user.id,
        scopeType: 'FACILITY',
        scopeId: row.facilityId,
        before: { status: 'PENDING' },
        after: { status: 'DECLINED' },
      });
      await publishEvent(tx, {
        eventType: EVENTS.StaffInvitationAnswered,
        aggregateType: 'identity.staff_invitations',
        aggregateId: row.id,
        payload: { invitationId: row.id, facilityId: row.facilityId, decision: 'declined' },
      });
      return { kind: 'done', answer: answered('declined') };
    }

    // Accepting. The authority that sent it is checked now, not when it was sent.
    const inviter = await tx.user.findFirst({
      where: { id: row.invitedBy, ...CAN_SIGN_IN },
      select: { id: true },
    });
    const inviterGrants = inviter ? await grantsOf(tx, inviter.id) : [];
    if (!inviter || !mayGive(inviterGrants, inviter.id, row.facilityId, row.roleKey)) {
      await tx.staffInvitation.update({
        where: { id: row.id },
        data: { status: 'CANCELLED', respondedAt: now },
      });
      await recordAudit(tx, {
        action: 'staff_invitation.withdrawn',
        entityType: 'identity.staff_invitations',
        entityId: row.id,
        actorId: user.id,
        scopeType: 'FACILITY',
        scopeId: row.facilityId,
        reason: 'Whoever sent it no longer holds the authority to give this role.',
        before: { status: 'PENDING' },
        after: { status: 'CANCELLED' },
      });
      return { kind: 'withdrawn' };
    }
    // Where the inviter's authority comes from, as it is now. Throws without marking anything.
    await assertScopeMayAddStaff(scope, inviter.id);

    const existing = await tx.userRole.findFirst({
      where: {
        userId: user.id,
        scopeType: 'FACILITY',
        scopeId: row.facilityId,
        revokedAt: null,
        role: { key: row.roleKey },
      },
      select: { id: true },
    });
    let grantId = existing?.id ?? null;
    if (!grantId) {
      const role = await ensureRole(tx, row.roleKey);
      const grant = await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id,
          scopeType: 'FACILITY',
          scopeId: row.facilityId,
          // The authority that gave it was the inviter's, whoever pressed the button.
          grantedBy: row.invitedBy,
        },
      });
      grantId = grant.id;
      await recordAudit(tx, {
        action: 'role.granted',
        entityType: 'identity.user_roles',
        entityId: grant.id,
        actorId: user.id,
        scopeType: 'FACILITY',
        scopeId: row.facilityId,
        after: {
          roleKey: row.roleKey,
          userId: user.id,
          permissions: ROLE_PERMISSIONS[row.roleKey],
          viaInvitation: row.id,
          invitedBy: row.invitedBy,
        },
      });
    }

    await tx.staffInvitation.update({
      where: { id: row.id },
      data: { status: 'ACCEPTED', respondedAt: now, respondedBy: user.id, grantId },
    });
    await recordAudit(tx, {
      action: 'staff_invitation.accepted',
      entityType: 'identity.staff_invitations',
      entityId: row.id,
      actorId: user.id,
      scopeType: 'FACILITY',
      scopeId: row.facilityId,
      before: { status: 'PENDING' },
      after: { status: 'ACCEPTED', grantId },
    });
    await publishEvent(tx, {
      eventType: EVENTS.StaffInvitationAnswered,
      aggregateType: 'identity.staff_invitations',
      aggregateId: row.id,
      payload: { invitationId: row.id, facilityId: row.facilityId, decision: 'accepted' },
    });

    return { kind: 'done', answer: { ...answered('accepted'), grantId } };
  });

  if (outcome.kind === 'expired') throw InvitationErrors.expired();
  if (outcome.kind === 'withdrawn') throw InvitationErrors.withdrawn();
  return outcome.answer;
}

