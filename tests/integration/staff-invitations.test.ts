import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

const sms = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/sms', async () => (await import('./support/sms-double')).gatewayDouble(sms.send));

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS, type Permission } from '@/lib/authz/permissions';
import { loadGrants } from '@/lib/authz/guard';
import { grantRole, revokeAllAccess, revokeGrant } from '@/modules/auth/application/grants';
import {
  cancelStaffInvitation,
  inviteStaff,
  listMyInvitations,
  listStaffInvitations,
  respondToStaffInvitation,
} from '@/modules/auth/application/staff-invitations';
import {
  INVITATION_LIMITS,
  INVITATION_VALID_DAYS,
  invitationText,
} from '@/modules/auth/domain/staff-invitation';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import { issueSession } from '@/modules/auth/application/session-service';
import { smsProblems } from '@/modules/notifications/domain/sms-hygiene';
import { runOnce } from '@/worker/processor';
import { handlers } from '@/worker/handlers';
import { POST as inviteRoute, GET as listRoute } from '@/app/api/v1/staff-invitations/route';
import { POST as cancelRoute } from '@/app/api/v1/staff-invitations/[id]/cancel/route';
import { GET as mineRoute } from '@/app/api/v1/staff-invitations/mine/route';
import { POST as respondRoute } from '@/app/api/v1/staff-invitations/[id]/respond/route';
import { clearCookies } from './support/cookie-jar';
import { createFacilityType, createState, createUser, ensureRole, grant } from './support/fixtures';
import { notifyStaffInvitationAnswered, notifyStaffInvited } from '@/modules/notifications/application/handlers';

/**
 * M04-06 part 2: inviting somebody to work for a facility, and their answer.
 *
 * A facility owner could give a registered person a role without asking them, and could not give
 * one to somebody who had not registered. An invitation is bound to the number the facility typed,
 * is told to that number by one text, and is a grant only once whoever holds the number, verified,
 * says yes, with the inviter's authority checked again at that moment.
 */

const SUPER = ROLE_PERMISSIONS.super_administrator as Permission[];
const OWNER = ROLE_PERMISSIONS.facility_owner as Permission[];

beforeEach(() => {
  clearCookies();
  sms.send.mockReset();
  sms.send.mockResolvedValue({ provider: 'test', providerMessageId: 'm-1', accepted: true });
});

afterEach(() => {
  // Every text this file causes is held to the rules every text is held to.
  for (const [message] of sms.send.mock.calls as [{ body: string }][]) {
    expect(smsProblems(message.body), message.body).toEqual([]);
  }
});

let numbers = 0;
/** A valid Nigerian mobile number nobody has registered. */
const strangerNumber = () => `+23480777${String(++numbers).padStart(5, '0')}`;

/** A facility that exists, is verified and has a name, with its representative as owner. */
async function realFacility(name = 'Owerri General Hospital') {
  await ensureRole('facility_owner', OWNER);
  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: `${name} Representative` });
  const operations = await createUser({ fullName: 'Operations Officer' });
  const officer = await createUser({ fullName: 'Compliance Officer' });
  const facility = await createFacility({
    name,
    facilityTypeId: facilityType.id,
    cacNumber: `RC${800_000 + Math.floor(Math.random() * 99_999)}`,
    stateId: state.id,
    addressLine: '1 Hospital Road',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: operations.id,
  });
  await verifyFacility({ facilityId: facility.id, verifierId: officer.id, decision: 'approve' });
  const holds = await prisma.userRole.count({
    where: { userId: representative.id, scopeType: 'FACILITY', scopeId: facility.id, revokedAt: null },
  });
  if (holds === 0) {
    await grantRole({
      userId: representative.id,
      roleKey: 'facility_owner',
      scopeType: 'FACILITY',
      scopeId: facility.id,
      actorId: representative.id,
      actorPermissions: SUPER,
    });
  }
  // The texts set-up caused are not what these tests are about.
  await drain();
  sms.send.mockClear();
  return { facilityId: facility.id, owner: representative, operations };
}

async function drain() {
  for (let round = 0; round < 6; round += 1) await runOnce({ handlers });
}

async function staffAt(facilityId: string, roleKey: string, name = 'Hauwa Abdullahi') {
  const user = await createUser({ fullName: name });
  const grant = await grantRole({
    userId: user.id,
    roleKey,
    scopeType: 'FACILITY',
    scopeId: facilityId,
    actorId: user.id,
    actorPermissions: SUPER,
  });
  return { user, grant };
}

const held = (userId: string, facilityId: string) =>
  prisma.userRole.findMany({
    where: { userId, scopeType: 'FACILITY', scopeId: facilityId, revokedAt: null },
    include: { role: true },
  });

const invitationRow = (id: string) => prisma.staffInvitation.findUniqueOrThrow({ where: { id } });
const textsTo = (phone: string) =>
  (sms.send.mock.calls as [{ to: string; body: string }][]).map(([message]) => message).filter((m) => m.to === phone);

describe('inviting somebody', () => {
  it('records a pending invitation for the number as written, good for a week', async () => {
    const { facilityId, owner } = await realFacility();
    const now = new Date('2026-10-17T10:00:00Z');

    const invitation = await inviteStaff({
      facilityId,
      phone: '0803 777 0001',
      roleKey: 'facility_administrator',
      actorId: owner.id,
      now,
    });

    const row = await invitationRow(invitation.id);
    expect(row.phone).toBe('+2348037770001');
    expect(row.status).toBe('PENDING');
    expect(row.roleKey).toBe('facility_administrator');
    expect(row.invitedBy).toBe(owner.id);
    expect(row.expiresAt.getTime() - now.getTime()).toBe(INVITATION_VALID_DAYS * 24 * 60 * 60 * 1000);
    // What comes back names the number only masked.
    expect(JSON.stringify(invitation)).not.toContain('8037770001');
    expect(invitation.status).toBe('PENDING');
  });

  it('answers the same whether or not the number has an account', async () => {
    const { facilityId, owner } = await realFacility();
    const registered = await createUser({ fullName: 'Already Registered' });

    const known = await inviteStaff({
      facilityId,
      phone: registered.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    const unknown = await inviteStaff({
      facilityId,
      phone: strangerNumber(),
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });

    const shape = (view: object) => Object.keys(view).sort();
    expect(shape(known)).toEqual(shape(unknown));
    expect(JSON.stringify(known)).not.toContain('Already Registered');
  });

  it('writes who invited whom, to what, into the facility’s own trail, without the number', async () => {
    const { facilityId, owner } = await realFacility();
    const invitation = await inviteStaff({
      facilityId,
      phone: '08037770002',
      roleKey: 'facility_owner',
      actorId: owner.id,
    });

    const rows = await prisma.auditLog.findMany({
      where: { action: 'staff_invitation.created', entityId: invitation.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: owner.id, scopeType: 'FACILITY', scopeId: facilityId });
    expect(rows[0]!.after).toMatchObject({ roleKey: 'facility_owner' });
    expect(JSON.stringify(rows[0])).not.toContain('8037770002');
  });

  it.each(['super_administrator', 'administrator', 'practitioner', 'made_up_role'])(
    'refuses a role a facility cannot give: %s',
    async (roleKey) => {
      const { facilityId, owner } = await realFacility();
      await expect(
        inviteStaff({ facilityId, phone: strangerNumber(), roleKey, actorId: owner.id }),
      ).rejects.toMatchObject({ code: 'role_not_invitable', status: 422 });
      expect(await prisma.staffInvitation.count()).toBe(0);
    },
  );

  it('refuses a number that is not a Nigerian mobile number', async () => {
    const { facilityId, owner } = await realFacility();
    await expect(
      inviteStaff({ facilityId, phone: '12345', roleKey: 'facility_administrator', actorId: owner.id }),
    ).rejects.toMatchObject({ code: 'invalid_phone' });
  });

  it('refuses somebody who cannot give the role they are inviting to', async () => {
    const { facilityId } = await realFacility();
    const administrator = await staffAt(facilityId, 'facility_administrator');

    // Holds neither role.grant nor everything an owner may do.
    await expect(
      inviteStaff({
        facilityId,
        phone: strangerNumber(),
        roleKey: 'facility_owner',
        actorId: administrator.user.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await prisma.staffInvitation.count()).toBe(0);
  });

  it('refuses to invite to a facility the inviter holds nothing at', async () => {
    const mine = await realFacility('Mine');
    const theirs = await realFacility('Theirs');

    await expect(
      inviteStaff({
        facilityId: theirs.facilityId,
        phone: strangerNumber(),
        roleKey: 'facility_administrator',
        actorId: mine.owner.id,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a second invitation while one is waiting, and allows one once it has been cancelled', async () => {
    const { facilityId, owner } = await realFacility();
    const phone = strangerNumber();
    const first = await inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id });

    await expect(
      inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id }),
    ).rejects.toMatchObject({ code: 'already_invited', status: 409 });

    await cancelStaffInvitation({ invitationId: first.id, facilityId, actorId: owner.id });
    const again = await inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id });
    expect(again.id).not.toBe(first.id);
  });

  it('allows a different role to the same number, and the same role from another facility', async () => {
    const one = await realFacility('One');
    const two = await realFacility('Two');
    const phone = strangerNumber();

    await inviteStaff({ facilityId: one.facilityId, phone, roleKey: 'facility_administrator', actorId: one.owner.id });
    await inviteStaff({ facilityId: one.facilityId, phone, roleKey: 'facility_owner', actorId: one.owner.id });
    await inviteStaff({ facilityId: two.facilityId, phone, roleKey: 'facility_administrator', actorId: two.owner.id });

    expect(await prisma.staffInvitation.count({ where: { phone, status: 'PENDING' } })).toBe(3);
  });

  it('allows a new invitation once the last one has run out, and marks the old one expired', async () => {
    const { facilityId, owner } = await realFacility();
    const phone = strangerNumber();
    const longAgo = new Date('2026-09-01T09:00:00Z');
    const old = await inviteStaff({
      facilityId,
      phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
      now: longAgo,
    });

    const fresh = await inviteStaff({
      facilityId,
      phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
      now: new Date('2026-10-17T10:00:00Z'),
    });

    expect((await invitationRow(old.id)).status).toBe('EXPIRED');
    expect((await invitationRow(fresh.id)).status).toBe('PENDING');
  });

  it('refuses to invite somebody who already holds the role there', async () => {
    const { facilityId, owner } = await realFacility();
    const colleague = await staffAt(facilityId, 'facility_administrator');

    await expect(
      inviteStaff({
        facilityId,
        phone: colleague.user.phone,
        roleKey: 'facility_administrator',
        actorId: owner.id,
      }),
    ).rejects.toMatchObject({ code: 'already_granted', status: 409 });
  });

  it('does not let two owners invite the same number at the same moment', async () => {
    const { facilityId, owner } = await realFacility();
    const second = await staffAt(facilityId, 'facility_owner', 'Second Owner');
    const phone = strangerNumber();
    // A cold pool can serialise the two and hide a missing guard.
    await prisma.$queryRaw`SELECT 1`;
    await Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]);

    const outcomes = await Promise.allSettled([
      inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id }),
      inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: second.user.id }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.staffInvitation.count({ where: { phone, status: 'PENDING' } })).toBe(1);
    await drain();
    expect(textsTo(phone)).toHaveLength(1);
  });
});

describe('how many may be sent', () => {
  /** Rows that were sent, for counting, without sending a text for each. */
  async function sentBefore(input: {
    facilityId: string;
    invitedBy: string;
    phone?: string;
    count: number;
    at: Date;
  }) {
    await prisma.staffInvitation.createMany({
      data: Array.from({ length: input.count }, () => ({
        facilityId: input.facilityId,
        phone: input.phone ?? strangerNumber(),
        roleKey: 'facility_administrator',
        invitedBy: input.invitedBy,
        status: 'CANCELLED' as const,
        expiresAt: new Date(input.at.getTime() + 7 * 86_400_000),
        createdAt: input.at,
      })),
    });
  }

  const NOW = new Date('2026-10-17T10:00:00Z');
  const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

  it('stops one person at ten an hour, and says it is a limit', async () => {
    const { facilityId, owner } = await realFacility();
    await sentBefore({
      facilityId,
      invitedBy: owner.id,
      count: INVITATION_LIMITS.perInviterPerHour,
      at: minutesAgo(30),
    });

    await expect(
      inviteStaff({
        facilityId,
        phone: strangerNumber(),
        roleKey: 'facility_administrator',
        actorId: owner.id,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'invitation_limit', status: 429 });
  });

  it('lets them send again once the hour has passed', async () => {
    const { facilityId, owner } = await realFacility();
    await sentBefore({
      facilityId,
      invitedBy: owner.id,
      count: INVITATION_LIMITS.perInviterPerHour,
      at: minutesAgo(61),
    });

    await expect(
      inviteStaff({
        facilityId,
        phone: strangerNumber(),
        roleKey: 'facility_administrator',
        actorId: owner.id,
        now: NOW,
      }),
    ).resolves.toBeDefined();
  });

  it('stops a facility at twenty a day, whoever sends them', async () => {
    const { facilityId, owner } = await realFacility();
    const colleague = await staffAt(facilityId, 'facility_owner', 'Second Owner');
    await sentBefore({
      facilityId,
      invitedBy: colleague.user.id,
      count: INVITATION_LIMITS.perFacilityPerDay,
      at: minutesAgo(5 * 60),
    });

    await expect(
      inviteStaff({
        facilityId,
        phone: strangerNumber(),
        roleKey: 'facility_administrator',
        actorId: owner.id,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'invitation_limit', status: 429 });
  });

  it('lets a facility send again after the day has passed', async () => {
    const { facilityId, owner } = await realFacility();
    const colleague = await staffAt(facilityId, 'facility_owner', 'Second Owner');
    await sentBefore({
      facilityId,
      invitedBy: colleague.user.id,
      count: INVITATION_LIMITS.perFacilityPerDay,
      at: minutesAgo(25 * 60),
    });

    await expect(
      inviteStaff({
        facilityId,
        phone: strangerNumber(),
        roleKey: 'facility_administrator',
        actorId: owner.id,
        now: NOW,
      }),
    ).resolves.toBeDefined();
  });

  it('stops one number being invited by several facilities in a day', async () => {
    const mine = await realFacility('Mine');
    const phone = strangerNumber();
    const others = await Promise.all([realFacility('Other One'), realFacility('Other Two'), realFacility('Other Three')]);
    for (const other of others.slice(0, INVITATION_LIMITS.perNumberPerDay)) {
      await sentBefore({ facilityId: other.facilityId, invitedBy: other.owner.id, phone, count: 1, at: minutesAgo(120) });
    }

    await expect(
      inviteStaff({
        facilityId: mine.facilityId,
        phone,
        roleKey: 'facility_administrator',
        actorId: mine.owner.id,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'invitation_limit', status: 429 });
    // And the refusal says nothing about who sent them.
    await expect(
      inviteStaff({
        facilityId: mine.facilityId,
        phone,
        roleKey: 'facility_administrator',
        actorId: mine.owner.id,
        now: NOW,
      }),
    ).rejects.toThrow(/several times/);
  });

  it('counts a refused or cancelled invitation as sent, since the text went', async () => {
    const { facilityId, owner } = await realFacility();
    const phone = strangerNumber();
    for (let sent = 0; sent < INVITATION_LIMITS.perNumberPerDay; sent += 1) {
      const invitation = await inviteStaff({
        facilityId,
        phone,
        roleKey: sent % 2 === 0 ? 'facility_administrator' : 'facility_owner',
        actorId: owner.id,
        now: NOW,
      });
      await cancelStaffInvitation({ invitationId: invitation.id, facilityId, actorId: owner.id });
    }

    await expect(
      inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id, now: NOW }),
    ).rejects.toMatchObject({ code: 'invitation_limit' });
  });
});

describe('the text that goes to the number', () => {
  it('is one text to the number invited, naming the facility and the role, sent once', async () => {
    const { facilityId, owner } = await realFacility('Aso Garden Specialist Hospital');
    const phone = strangerNumber();
    await inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id });

    await drain();
    await drain();

    const texts = textsTo(phone);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.body).toBe(
      invitationText({ facilityName: 'Aso Garden Specialist Hospital', roleKey: 'facility_administrator' }),
    );
  });

  it('is recorded on the invitation, since the number may have no account', async () => {
    const { facilityId, owner } = await realFacility();
    const invitation = await inviteStaff({
      facilityId,
      phone: strangerNumber(),
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    expect((await invitationRow(invitation.id)).smsSentAt).toBeNull();

    await drain();

    const row = await invitationRow(invitation.id);
    expect(row.smsSentAt).not.toBeNull();
    expect(row.smsFailureReason).toBeNull();
  });

  it('is retried when the gateway refuses it, and says why in the meantime', async () => {
    const { facilityId, owner } = await realFacility();
    const phone = strangerNumber();
    const invitation = await inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id });
    sms.send.mockResolvedValue({ provider: 'test', providerMessageId: null, accepted: false });

    await drain();

    let row = await invitationRow(invitation.id);
    expect(row.smsSentAt).toBeNull();
    expect(row.smsFailureReason).toMatch(/not accept/i);
    const listed = await listStaffInvitations({ facilityId });
    expect(listed.find((entry) => entry.id === invitation.id)?.text).toBe('failed');

    // The outbox's own backoff decides when; a later run reaches it once the gateway is back.
    await prisma.outboxEvent.updateMany({ where: { status: { not: 'PROCESSED' } }, data: { availableAt: new Date(0) } });
    sms.send.mockResolvedValue({ provider: 'test', providerMessageId: 'm-2', accepted: true });
    await drain();

    row = await invitationRow(invitation.id);
    expect(row.smsSentAt).not.toBeNull();
    expect(row.smsFailureReason).toBeNull();
    // One refused try and one that went, the same words both times.
    const tries = textsTo(phone);
    expect(tries).toHaveLength(2);
    expect(tries[1]!.body).toBe(tries[0]!.body);
  });

  it('goes once however many times the event is delivered', async () => {
    const { facilityId, owner } = await realFacility();
    const phone = strangerNumber();
    const invitation = await inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id });

    await notifyStaffInvited({ invitationId: invitation.id });
    await notifyStaffInvited({ invitationId: invitation.id });
    await notifyStaffInvited({ invitationId: invitation.id });

    expect(textsTo(phone)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'staff_invitation.text_sent', entityId: invitation.id } })).toBe(1);
  });

  it('writes a row in the trail for each try, without the number or the words', async () => {
    const { facilityId, owner } = await realFacility();
    const phone = strangerNumber();
    const invitation = await inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id });
    sms.send.mockRejectedValue(new Error(`gateway said no to ${phone}`));

    await expect(notifyStaffInvited({ invitationId: invitation.id })).rejects.toThrow();

    const rows = await prisma.auditLog.findMany({ where: { action: 'staff_invitation.text_failed', entityId: invitation.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: 'worker', scopeType: 'FACILITY', scopeId: facilityId });
    expect(JSON.stringify(rows[0])).not.toContain(phone.slice(4));
  });

  it('is not sent for an invitation that was cancelled before the worker ran', async () => {
    const { facilityId, owner } = await realFacility();
    const phone = strangerNumber();
    const invitation = await inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id });
    await cancelStaffInvitation({ invitationId: invitation.id, facilityId, actorId: owner.id });

    await drain();

    expect(textsTo(phone)).toHaveLength(0);
  });
});

describe('what the facility sees', () => {
  it('lists its invitations, newest first, with the number masked and what became of each', async () => {
    const { facilityId, owner } = await realFacility();
    const first = await inviteStaff({
      facilityId,
      phone: '08037770010',
      roleKey: 'facility_administrator',
      actorId: owner.id,
      now: new Date('2026-10-16T10:00:00Z'),
    });
    const second = await inviteStaff({
      facilityId,
      phone: '08037770011',
      roleKey: 'facility_owner',
      actorId: owner.id,
      now: new Date('2026-10-17T10:00:00Z'),
    });
    await cancelStaffInvitation({ invitationId: first.id, facilityId, actorId: owner.id });

    const listed = await listStaffInvitations({ facilityId, now: new Date('2026-10-17T11:00:00Z') });

    expect(listed.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(listed.map((entry) => entry.status)).toEqual(['PENDING', 'CANCELLED']);
    expect(listed[0]!.invitedBy.fullName).toBe('Owerri General Hospital Representative');
    expect(JSON.stringify(listed)).not.toContain('8037770010');
    expect(JSON.stringify(listed)).not.toContain('8037770011');
    expect(listed[0]!.phone).toMatch(/\*/);
  });

  it('shows one that has run out as expired, without anything having marked it', async () => {
    const { facilityId, owner } = await realFacility();
    const invitation = await inviteStaff({
      facilityId,
      phone: strangerNumber(),
      roleKey: 'facility_administrator',
      actorId: owner.id,
      now: new Date('2026-10-01T10:00:00Z'),
    });
    expect((await invitationRow(invitation.id)).status).toBe('PENDING');

    const listed = await listStaffInvitations({ facilityId, now: new Date('2026-10-17T10:00:00Z') });

    expect(listed[0]!.status).toBe('EXPIRED');
  });

  it('lists only its own facility’s invitations', async () => {
    const mine = await realFacility('Mine');
    const theirs = await realFacility('Theirs');
    await inviteStaff({
      facilityId: theirs.facilityId,
      phone: strangerNumber(),
      roleKey: 'facility_administrator',
      actorId: theirs.owner.id,
    });

    expect(await listStaffInvitations({ facilityId: mine.facilityId })).toEqual([]);
  });
});

describe('cancelling', () => {
  it('ends a pending invitation and records who did it', async () => {
    const { facilityId, owner } = await realFacility();
    const invitation = await inviteStaff({
      facilityId,
      phone: strangerNumber(),
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    const colleague = await staffAt(facilityId, 'facility_owner', 'Second Owner');

    await cancelStaffInvitation({ invitationId: invitation.id, facilityId, actorId: colleague.user.id });

    const row = await invitationRow(invitation.id);
    expect(row).toMatchObject({ status: 'CANCELLED', respondedBy: colleague.user.id });
    expect(row.respondedAt).not.toBeNull();
    const audit = await prisma.auditLog.findMany({
      where: { action: 'staff_invitation.cancelled', entityId: invitation.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: colleague.user.id, scopeType: 'FACILITY', scopeId: facilityId });
  });

  it('is not found for another facility’s invitation, and changes nothing', async () => {
    const mine = await realFacility('Mine');
    const theirs = await realFacility('Theirs');
    const invitation = await inviteStaff({
      facilityId: theirs.facilityId,
      phone: strangerNumber(),
      roleKey: 'facility_administrator',
      actorId: theirs.owner.id,
    });

    await expect(
      cancelStaffInvitation({ invitationId: invitation.id, facilityId: mine.facilityId, actorId: mine.owner.id }),
    ).rejects.toMatchObject({ code: 'invitation_not_found', status: 404 });
    expect((await invitationRow(invitation.id)).status).toBe('PENDING');
  });

  it('cannot undo an answer', async () => {
    const { facilityId, owner } = await realFacility();
    const person = await createUser({ fullName: 'Will Accept' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    await respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' });

    await expect(
      cancelStaffInvitation({ invitationId: invitation.id, facilityId, actorId: owner.id }),
    ).rejects.toMatchObject({ code: 'invitation_closed', status: 409 });
    expect((await invitationRow(invitation.id)).status).toBe('ACCEPTED');
    expect(await held(person.id, facilityId)).toHaveLength(1);
  });
});

describe('what the person invited sees', () => {
  it('is the invitations waiting for the number they have verified, and nobody else’s', async () => {
    const { facilityId, owner } = await realFacility('Aso Garden Specialist Hospital');
    const me = await createUser({ fullName: 'Me' });
    const somebodyElse = await createUser({ fullName: 'Somebody Else' });
    const mine = await inviteStaff({ facilityId, phone: me.phone, roleKey: 'facility_administrator', actorId: owner.id });
    await inviteStaff({ facilityId, phone: somebodyElse.phone, roleKey: 'facility_owner', actorId: owner.id });

    const listed = await listMyInvitations({ userId: me.id });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: mine.id,
      facilityName: 'Aso Garden Specialist Hospital',
      roleKey: 'facility_administrator',
      invitedByName: 'Aso Garden Specialist Hospital Representative',
    });
    expect(JSON.stringify(listed)).not.toContain(somebodyElse.phone);
  });

  it('is nothing until the number is verified: knowing a number is not holding it', async () => {
    const { facilityId, owner } = await realFacility();
    const unverified = await prisma.user.create({
      data: { phone: strangerNumber(), fullName: 'Not Verified', status: 'PENDING_VERIFICATION' },
    });
    await inviteStaff({ facilityId, phone: unverified.phone, roleKey: 'facility_administrator', actorId: owner.id });

    expect(await listMyInvitations({ userId: unverified.id })).toEqual([]);
  });

  it('leaves out one that has been answered, cancelled or has run out', async () => {
    const { facilityId, owner } = await realFacility();
    const me = await createUser({ fullName: 'Me' });
    const declined = await inviteStaff({ facilityId, phone: me.phone, roleKey: 'facility_administrator', actorId: owner.id });
    await respondToStaffInvitation({ invitationId: declined.id, userId: me.id, decision: 'decline' });
    const cancelled = await inviteStaff({ facilityId, phone: me.phone, roleKey: 'facility_owner', actorId: owner.id });
    await cancelStaffInvitation({ invitationId: cancelled.id, facilityId, actorId: owner.id });
    await inviteStaff({
      facilityId,
      phone: me.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
      now: new Date('2026-09-01T10:00:00Z'),
    });

    expect(await listMyInvitations({ userId: me.id })).toEqual([]);
  });

  it('reaches somebody who registers after being invited, with nothing more than the number', async () => {
    const { facilityId, owner } = await realFacility();
    const phone = strangerNumber();
    const invitation = await inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id });

    const later = await prisma.user.create({
      data: { phone, fullName: 'Registered Afterwards', status: 'ACTIVE', phoneVerifiedAt: new Date() },
    });

    expect((await listMyInvitations({ userId: later.id })).map((entry) => entry.id)).toEqual([invitation.id]);
  });
});

describe('accepting', () => {
  it('gives the role at the facility, granted by the one who invited, and ends the invitation', async () => {
    const { facilityId, owner } = await realFacility();
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    expect(await held(person.id, facilityId)).toHaveLength(0);

    const result = await respondToStaffInvitation({
      invitationId: invitation.id,
      userId: person.id,
      decision: 'accept',
    });

    const grants = await held(person.id, facilityId);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ grantedBy: owner.id });
    expect(grants[0]!.role.key).toBe('facility_administrator');
    expect(result).toMatchObject({ decision: 'accepted', facilityId });
    const row = await invitationRow(invitation.id);
    expect(row).toMatchObject({ status: 'ACCEPTED', respondedBy: person.id, grantId: grants[0]!.id });
    // Live on their next request: grants are read, not cached.
    const live = await loadGrants(person.id);
    expect(live.some((entry) => entry.scopeId === facilityId && entry.permission === 'service_request.read')).toBe(true);
  });

  it('records the grant and the acceptance in the facility’s trail', async () => {
    const { facilityId, owner } = await realFacility();
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });

    await respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' });

    const accepted = await prisma.auditLog.findMany({
      where: { action: 'staff_invitation.accepted', entityId: invitation.id },
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ actorId: person.id, scopeType: 'FACILITY', scopeId: facilityId });
    const granted = await prisma.auditLog.findMany({
      where: { action: 'role.granted', scopeId: facilityId, actorId: person.id },
    });
    expect(granted).toHaveLength(1);
    expect(granted[0]!.after).toMatchObject({ viaInvitation: invitation.id, invitedBy: owner.id });
  });

  it('is the same answer the second time, and gives nothing twice', async () => {
    const { facilityId, owner } = await realFacility();
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });

    const first = await respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' });
    const second = await respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' });

    expect(second).toEqual(first);
    expect(await held(person.id, facilityId)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'staff_invitation.accepted', entityId: invitation.id } })).toBe(1);
  });

  it('is one grant when two answers arrive at the same moment', async () => {
    const { facilityId, owner } = await realFacility();
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    await Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]);

    await Promise.allSettled([
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
    ]);

    expect(await held(person.id, facilityId)).toHaveLength(1);
    expect((await invitationRow(invitation.id)).status).toBe('ACCEPTED');
  });

  it('does not give the role twice to somebody who already holds it, and still closes the invitation', async () => {
    const { facilityId, owner } = await realFacility();
    const person = await staffAt(facilityId, 'facility_administrator');
    // Invited before they were given it another way.
    const invitation = await prisma.staffInvitation.create({
      data: {
        facilityId,
        phone: person.user.phone,
        roleKey: 'facility_administrator',
        invitedBy: owner.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await respondToStaffInvitation({ invitationId: invitation.id, userId: person.user.id, decision: 'accept' });

    expect(await held(person.user.id, facilityId)).toHaveLength(1);
    expect(await invitationRow(invitation.id)).toMatchObject({ status: 'ACCEPTED', grantId: person.grant.id });
  });

  it('gives the role again to somebody who held it and had it taken away', async () => {
    const { facilityId, owner } = await realFacility();
    const person = await staffAt(facilityId, 'facility_administrator');
    await revokeGrant({
      scope: { type: 'FACILITY', id: facilityId },
      grantId: person.grant.id,
      actorId: owner.id,
      reason: 'Left the hospital for a while.',
      actorPermissions: OWNER,
    });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.user.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });

    await respondToStaffInvitation({ invitationId: invitation.id, userId: person.user.id, decision: 'accept' });

    expect(await held(person.user.id, facilityId)).toHaveLength(1);
  });

  it('tells the one who invited, once, without naming anybody', async () => {
    const { facilityId, owner } = await realFacility('Aso Garden Specialist Hospital');
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    await drain();
    sms.send.mockClear();

    await respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' });
    await drain();
    await drain();

    const told = await prisma.notificationMessage.findMany({
      where: { userId: owner.id, kind: 'staff.invitation_accepted' },
    });
    expect(told).toHaveLength(1);
    expect(told[0]!.body).toContain('Aso Garden Specialist Hospital');
    expect(told[0]!.body).not.toContain('Hauwa');
    expect(told[0]!.relatedId).toBe(invitation.id);

    // The same event delivered again tells nobody twice.
    await notifyStaffInvitationAnswered({ invitationId: invitation.id, decision: 'accepted' });
    expect(await prisma.notificationMessage.count({ where: { userId: owner.id, kind: 'staff.invitation_accepted' } })).toBe(1);
  });
});

describe('declining', () => {
  it('ends the invitation, gives nothing, and tells the one who invited', async () => {
    const { facilityId, owner } = await realFacility('Aso Garden Specialist Hospital');
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_owner',
      actorId: owner.id,
    });
    await drain();
    sms.send.mockClear();

    const result = await respondToStaffInvitation({
      invitationId: invitation.id,
      userId: person.id,
      decision: 'decline',
    });
    await drain();

    expect(result).toMatchObject({ decision: 'declined', facilityId });
    expect(await held(person.id, facilityId)).toHaveLength(0);
    expect(await invitationRow(invitation.id)).toMatchObject({ status: 'DECLINED', respondedBy: person.id, grantId: null });
    const told = await prisma.notificationMessage.findMany({
      where: { userId: owner.id, kind: 'staff.invitation_declined' },
    });
    expect(told).toHaveLength(1);
    expect(told[0]!.body).not.toContain('Hauwa');
    expect(await prisma.auditLog.count({ where: { action: 'staff_invitation.declined', entityId: invitation.id } })).toBe(1);
  });

  it('cannot be turned into an acceptance afterwards', async () => {
    const { facilityId, owner } = await realFacility();
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    await respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'decline' });

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'invitation_closed', status: 409 });
    expect(await held(person.id, facilityId)).toHaveLength(0);
  });
});

describe('who may answer', () => {
  it('is nobody but the holder of the number: anyone else is told it does not exist', async () => {
    const { facilityId, owner } = await realFacility();
    const invited = await createUser({ fullName: 'Invited' });
    const stranger = await createUser({ fullName: 'Stranger' });
    const invitation = await inviteStaff({
      facilityId,
      phone: invited.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });

    for (const decision of ['accept', 'decline'] as const) {
      await expect(
        respondToStaffInvitation({ invitationId: invitation.id, userId: stranger.id, decision }),
      ).rejects.toMatchObject({ code: 'invitation_not_found', status: 404 });
    }
    expect(await invitationRow(invitation.id)).toMatchObject({ status: 'PENDING', grantId: null });
    expect(await held(stranger.id, facilityId)).toHaveLength(0);
  });

  it('is not somebody who has the number on an account that never verified it', async () => {
    const { facilityId, owner } = await realFacility();
    const phone = strangerNumber();
    const squatter = await prisma.user.create({
      data: { phone, fullName: 'Squatter', status: 'ACTIVE', phoneVerifiedAt: null },
    });
    const invitation = await inviteStaff({ facilityId, phone, roleKey: 'facility_administrator', actorId: owner.id });

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: squatter.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'invitation_not_found' });
    expect(await held(squatter.id, facilityId)).toHaveLength(0);
  });

  it.each(['SUSPENDED', 'DEACTIVATED'] as const)('is not an account that is %s', async (status) => {
    const { facilityId, owner } = await realFacility();
    const person = await createUser({ fullName: 'Locked Out' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    await prisma.user.update({ where: { id: person.id }, data: { status } });

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'invitation_not_found' });
  });

  it('is told an invitation that does not exist does not exist', async () => {
    const person = await createUser({ fullName: 'Nobody' });
    await expect(
      respondToStaffInvitation({ invitationId: randomUUID(), userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'invitation_not_found', status: 404 });
  });
});

describe('an invitation that can no longer be accepted', () => {
  async function pending(facilityNameForText = 'Owerri General Hospital') {
    const world = await realFacility(facilityNameForText);
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId: world.facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: world.owner.id,
    });
    return { ...world, person, invitation };
  }

  it('has run out: refused, marked expired, nothing granted', async () => {
    const { facilityId, person, invitation } = await pending();
    const later = new Date(Date.now() + (INVITATION_VALID_DAYS + 1) * 86_400_000);

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept', now: later }),
    ).rejects.toMatchObject({ code: 'invitation_expired', status: 409 });

    expect((await invitationRow(invitation.id)).status).toBe('EXPIRED');
    expect(await held(person.id, facilityId)).toHaveLength(0);
  });

  it('can still be declined by its date, so the facility is not left waiting', async () => {
    const { person, invitation } = await pending();
    const later = new Date(Date.now() + (INVITATION_VALID_DAYS + 1) * 86_400_000);

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'decline', now: later }),
    ).rejects.toMatchObject({ code: 'invitation_expired' });
    expect((await invitationRow(invitation.id)).status).toBe('EXPIRED');
  });

  it('was cancelled: refused, nothing granted', async () => {
    const { facilityId, owner, person, invitation } = await pending();
    await cancelStaffInvitation({ invitationId: invitation.id, facilityId, actorId: owner.id });

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'invitation_closed', status: 409 });
    expect(await held(person.id, facilityId)).toHaveLength(0);
  });

  it('was sent by somebody who has since been removed from the facility: refused and withdrawn', async () => {
    const world = await realFacility();
    const second = await staffAt(world.facilityId, 'facility_owner', 'Second Owner');
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId: world.facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: second.user.id,
    });
    await revokeAllAccess({
      userId: second.user.id,
      scope: { type: 'FACILITY', id: world.facilityId },
      actorId: world.owner.id,
      reason: 'Left the hospital this week.',
      actorPermissions: OWNER,
    });

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'invitation_withdrawn', status: 409 });

    expect(await held(person.id, world.facilityId)).toHaveLength(0);
    expect((await invitationRow(invitation.id)).status).toBe('CANCELLED');
    expect(await prisma.auditLog.count({ where: { action: 'staff_invitation.withdrawn', entityId: invitation.id } })).toBe(1);
  });

  it('was sent by an owner who is now only an administrator, for a role that needs an owner: refused', async () => {
    const world = await realFacility();
    const second = await staffAt(world.facilityId, 'facility_owner', 'Second Owner');
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId: world.facilityId,
      phone: person.phone,
      roleKey: 'facility_owner',
      actorId: second.user.id,
    });
    // Demoted: their owner grant ends and an administrator grant begins.
    await revokeGrant({
      scope: { type: 'FACILITY', id: world.facilityId },
      grantId: second.grant.id,
      actorId: world.owner.id,
      reason: 'Moved to a different post.',
      actorPermissions: OWNER,
    });
    await grantRole({
      userId: second.user.id,
      roleKey: 'facility_administrator',
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
      actorId: world.owner.id,
      actorPermissions: OWNER,
    });

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'invitation_withdrawn' });
    expect(await held(person.id, world.facilityId)).toHaveLength(0);
  });

  it('was sent by somebody who can still give access but not everything the role carries: refused', async () => {
    const world = await realFacility();
    const second = await staffAt(world.facilityId, 'facility_owner', 'Second Owner');
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId: world.facilityId,
      phone: person.phone,
      roleKey: 'facility_owner',
      actorId: second.user.id,
    });
    // Their owner role ends and they are left holding `role.grant` and little else.
    await revokeGrant({
      scope: { type: 'FACILITY', id: world.facilityId },
      grantId: second.grant.id,
      actorId: world.owner.id,
      reason: 'Reduced to appointing others only.',
      actorPermissions: OWNER,
    });
    await grant({
      userId: second.user.id,
      roleKey: 'appointer_only',
      permissions: ['role.grant'],
      scopeType: 'FACILITY',
      scopeId: world.facilityId,
    });

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'invitation_withdrawn' });
    expect(await held(person.id, world.facilityId)).toHaveLength(0);
  });

  it('was sent by somebody whose account has since been suspended: refused', async () => {
    const world = await realFacility();
    const second = await staffAt(world.facilityId, 'facility_owner', 'Second Owner');
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId: world.facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: second.user.id,
    });
    await prisma.user.update({ where: { id: second.user.id }, data: { status: 'SUSPENDED' } });

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'invitation_withdrawn' });
    expect(await held(person.id, world.facilityId)).toHaveLength(0);
  });

  it('is for a facility that is no longer verified, from an owner whose authority is the facility’s: refused', async () => {
    const { facilityId, person, invitation } = await pending();
    await prisma.facility.update({ where: { id: facilityId }, data: { status: 'SUSPENDED' } });

    await expect(
      respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
    ).rejects.toMatchObject({ code: 'staff_requires_verified_facility' });
    expect(await held(person.id, facilityId)).toHaveLength(0);
    // Not marked withdrawn: the facility may be reinstated, and the invitation stands until its date.
    expect((await invitationRow(invitation.id)).status).toBe('PENDING');
  });

  it('is for a facility still being onboarded, from Medilink: accepted, since Medilink’s authority is not the facility’s', async () => {
    const world = await realFacility();
    await prisma.facility.update({ where: { id: world.facilityId }, data: { status: 'PENDING' } });
    const operations = await createUser({ fullName: 'Operations' });
    await grantRole({
      userId: operations.id,
      roleKey: 'super_administrator',
      scopeType: 'PLATFORM',
      actorId: operations.id,
      actorPermissions: SUPER,
    });
    const person = await createUser({ fullName: 'First Owner' });
    const invitation = await inviteStaff({
      facilityId: world.facilityId,
      phone: person.phone,
      roleKey: 'facility_owner',
      actorId: operations.id,
    });

    await respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' });

    expect(await held(person.id, world.facilityId)).toHaveLength(1);
  });

  it('races a cancellation: one outcome, never a grant from a cancelled invitation', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { facilityId, owner, person, invitation } = await pending();
      await Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]);

      await Promise.allSettled([
        respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' }),
        cancelStaffInvitation({ invitationId: invitation.id, facilityId, actorId: owner.id }),
      ]);

      const row = await invitationRow(invitation.id);
      const grants = await held(person.id, facilityId);
      if (row.status === 'ACCEPTED') expect(grants).toHaveLength(1);
      else {
        expect(row.status).toBe('CANCELLED');
        expect(grants).toHaveLength(0);
      }
    }
  });
});

/**
 * Holds the facility's staff lock from a transaction of its own until released, so a test can see
 * whether an operation waits for it. A race between two real calls proves little here: the
 * database's one-live-grant rule and the connection pool's timing hide a missing lock, which is how
 * it was missed once. This shows it directly.
 */
async function holdingTheFacilityLock(facilityId: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let acquired!: () => void;
  const held = new Promise<void>((resolve) => (acquired = resolve));
  const key = `staff-access:FACILITY:${facilityId}`;
  const transaction = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      acquired();
      await released;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  await held;
  return { release, done: transaction };
}

const nothingHappensWhile = (promise: Promise<unknown>) => {
  let finished = false;
  void promise.then(
    () => (finished = true),
    () => (finished = true),
  );
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return finished;
  };
};

describe('taking turns at one facility', () => {
  it('has an invitation wait for whoever is changing who may act for the facility', async () => {
    const { facilityId, owner } = await realFacility();
    const gate = await holdingTheFacilityLock(facilityId);

    const inviting = inviteStaff({
      facilityId,
      phone: strangerNumber(),
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    const finishedWhileHeld = await nothingHappensWhile(inviting)();
    gate.release();
    await gate.done;
    await inviting;

    expect(finishedWhileHeld).toBe(false);
  });

  it('has an answer wait, so it cannot slip past the removal of whoever sent the invitation', async () => {
    const { facilityId, owner } = await realFacility();
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    const gate = await holdingTheFacilityLock(facilityId);

    const answering = respondToStaffInvitation({ invitationId: invitation.id, userId: person.id, decision: 'accept' });
    const finishedWhileHeld = await nothingHappensWhile(answering)();
    gate.release();
    await gate.done;
    await answering;

    expect(finishedWhileHeld).toBe(false);
    expect(await held(person.id, facilityId)).toHaveLength(1);
  });

  it('has a cancellation wait, so it cannot be overtaken by the answer it was racing', async () => {
    const { facilityId, owner } = await realFacility();
    const invitation = await inviteStaff({
      facilityId,
      phone: strangerNumber(),
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    const gate = await holdingTheFacilityLock(facilityId);

    const cancelling = cancelStaffInvitation({ invitationId: invitation.id, facilityId, actorId: owner.id });
    const finishedWhileHeld = await nothingHappensWhile(cancelling)();
    gate.release();
    await gate.done;
    await cancelling;

    expect(finishedWhileHeld).toBe(false);
    expect((await invitationRow(invitation.id)).status).toBe('CANCELLED');
  });
});

describe('through the routes', () => {
  const post = (url: string, body: unknown) =>
    new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  async function signedInAs(userId: string, stepUp = true) {
    clearCookies();
    await issueSession({ userId, stepUp });
  }

  it('lets an owner who has just confirmed their password invite, and says nothing of the number’s account', async () => {
    const { facilityId, owner } = await realFacility();
    await signedInAs(owner.id);

    const response = await inviteRoute(
      post('http://localhost/api/v1/staff-invitations', {
        facilityId,
        phone: '0803 777 0099',
        roleKey: 'facility_administrator',
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe('PENDING');
    expect(JSON.stringify(body)).not.toContain('8037770099');
  });

  it('asks an owner who has not confirmed their password to do so first', async () => {
    const { facilityId, owner } = await realFacility();
    await signedInAs(owner.id, false);

    const response = await inviteRoute(
      post('http://localhost/api/v1/staff-invitations', {
        facilityId,
        phone: strangerNumber(),
        roleKey: 'facility_administrator',
      }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('step_up_required');
    expect(await prisma.staffInvitation.count()).toBe(0);
  });

  it('refuses somebody who cannot add staff', async () => {
    const { facilityId } = await realFacility();
    const administrator = await staffAt(facilityId, 'facility_administrator');
    await signedInAs(administrator.user.id);

    const response = await inviteRoute(
      post('http://localhost/api/v1/staff-invitations', {
        facilityId,
        phone: strangerNumber(),
        roleKey: 'facility_administrator',
      }),
    );

    expect(response.status).toBe(403);
  });

  it('refuses a facility that has not been verified, for an owner whose authority is its own', async () => {
    const { facilityId, owner } = await realFacility();
    await prisma.facility.update({ where: { id: facilityId }, data: { status: 'PENDING' } });
    await signedInAs(owner.id);

    const response = await inviteRoute(
      post('http://localhost/api/v1/staff-invitations', {
        facilityId,
        phone: strangerNumber(),
        roleKey: 'facility_administrator',
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.staffInvitation.count()).toBe(0);
  });

  it('lists the facility’s invitations for the owner', async () => {
    const { facilityId, owner } = await realFacility();
    await inviteStaff({ facilityId, phone: strangerNumber(), roleKey: 'facility_administrator', actorId: owner.id });
    await signedInAs(owner.id);

    const response = await listRoute(new Request(`http://localhost/api/v1/staff-invitations?facilityId=${facilityId}`));

    expect(response.status).toBe(200);
    expect((await response.json()).invitations).toHaveLength(1);
  });

  it('cancels through the route, naming the facility', async () => {
    const { facilityId, owner } = await realFacility();
    const invitation = await inviteStaff({
      facilityId,
      phone: strangerNumber(),
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    await signedInAs(owner.id);

    const response = await cancelRoute(
      post(`http://localhost/api/v1/staff-invitations/${invitation.id}/cancel`, { facilityId }),
      { params: Promise.resolve({ id: invitation.id }) },
    );

    expect(response.status).toBe(200);
    expect((await invitationRow(invitation.id)).status).toBe('CANCELLED');
  });

  it('shows a person their own invitations, with no permission to hold, and accepts on their word alone', async () => {
    const { facilityId, owner } = await realFacility('Aso Garden Specialist Hospital');
    const person = await createUser({ fullName: 'Hauwa Abdullahi' });
    const invitation = await inviteStaff({
      facilityId,
      phone: person.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    // No step-up: they hold no authority yet, and the one who invited has already proved theirs.
    await signedInAs(person.id, false);

    const mine = await mineRoute(new Request('http://localhost/api/v1/staff-invitations/mine'));
    expect(mine.status).toBe(200);
    expect((await mine.json()).invitations.map((entry: { id: string }) => entry.id)).toEqual([invitation.id]);

    const answered = await respondRoute(
      post(`http://localhost/api/v1/staff-invitations/${invitation.id}/respond`, { decision: 'accept' }),
      { params: Promise.resolve({ id: invitation.id }) },
    );
    expect(answered.status).toBe(200);
    expect(await held(person.id, facilityId)).toHaveLength(1);
  });

  it('answers 404, not 403, to somebody else’s invitation', async () => {
    const { facilityId, owner } = await realFacility();
    const invited = await createUser({ fullName: 'Invited' });
    const stranger = await createUser({ fullName: 'Stranger' });
    const invitation = await inviteStaff({
      facilityId,
      phone: invited.phone,
      roleKey: 'facility_administrator',
      actorId: owner.id,
    });
    await signedInAs(stranger.id, false);

    const response = await respondRoute(
      post(`http://localhost/api/v1/staff-invitations/${invitation.id}/respond`, { decision: 'accept' }),
      { params: Promise.resolve({ id: invitation.id }) },
    );

    expect(response.status).toBe(404);
  });

  it('refuses somebody who is not signed in', async () => {
    clearCookies();
    const response = await mineRoute(new Request('http://localhost/api/v1/staff-invitations/mine'));
    expect(response.status).toBe(401);
  });
});
