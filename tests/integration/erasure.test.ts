import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

// The bucket is not available to these tests; what matters is which files were
// asked to be deleted, and what happens when one cannot be.
const deleteObject = vi.hoisted(() => vi.fn<(key: string) => Promise<void>>(async () => {}));
vi.mock('@/lib/storage/tigris', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/storage/tigris')>()),
  deleteObject,
}));

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { executeErasure } from '@/modules/audit-compliance/application/erasure';
import {
  closeRequest,
  raiseRequest,
  startRequest,
} from '@/modules/audit-compliance/application/data-subject';
import { login } from '@/modules/auth/application/login';
import { POST as eraseRoute } from '@/app/api/v1/data-requests/[id]/erase/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { buildBookingWorld, eligiblePractitioner } from './support/booking-world';
import { createUser, grant } from './support/fixtures';

/**
 * AUD-01. Erasure used to assess blockers and explain, and closing the request
 * recorded words and deleted nothing: no code replaced a name, deleted a file or
 * closed the account.
 *
 * The schedule these assert is the one the product already states to the person
 * (ERASURE_EXEMPT_REASON): the audit trail and the financial ledger are kept
 * under legal obligation and identifying details are replaced.
 */

const NAME = 'Zephyrine Quillfeather';
const EMAIL = 'zephyrine.q@example.org';
const PHONE = '+2348035550142';
const PHONE_DIGITS = '8035550142';
const PASSWORD = 'correct horse battery staple';

beforeEach(() => {
  clearCookies();
  deleteObject.mockReset();
  deleteObject.mockResolvedValue(undefined);
});

async function operator() {
  const user = await createUser({ fullName: 'Data Protection Officer' });
  await grant({
    userId: user.id,
    roleKey: 'administrator',
    permissions: ROLE_PERMISSIONS.administrator ?? [],
    scopeType: 'PLATFORM',
  });
  return user;
}

/**
 * A practitioner with a footprint in every place the platform keeps one, and a
 * shift worked, invoiced and paid for.
 */
async function subject() {
  const world = await buildBookingWorld();
  const person = await eligiblePractitioner(world, NAME);
  const userId = person.id;
  const { hashPassword } = await import('@/lib/password');
  await prisma.user.update({
    where: { id: userId },
    data: { email: EMAIL, phone: PHONE, passwordHash: await hashPassword(PASSWORD) },
  });

  await prisma.practitionerProfile.update({
    where: { userId },
    data: { bio: `${NAME}, a nurse who has worked in Owerri`, photoObjectKey: `practitioner-photo/${userId}/me.jpg` },
  });
  await prisma.credentialSubmission.updateMany({
    where: { userId },
    data: {
      referenceNumber: 'LIC-ZQ-001',
      documentObjectKey: `credential/${userId}/licence.pdf`,
      reviewNotes: `Checked against the register for ${NAME}`,
    },
  });
  await prisma.storedObject.createMany({
    data: [
      { bucket: 'b', objectKey: `practitioner-photo/${userId}/me.jpg`, contentType: 'image/jpeg', sizeBytes: 10, purpose: 'practitioner-photo', ownerUserId: userId },
      { bucket: 'b', objectKey: `credential/${userId}/licence.pdf`, contentType: 'application/pdf', sizeBytes: 10, purpose: 'credential', ownerUserId: userId },
    ],
  });

  await prisma.session.create({
    data: { userId, tokenHash: `hash-${userId}`, ipAddress: '102.89.1.1', userAgent: 'Chrome', expiresAt: new Date(Date.now() + 3_600_000) },
  });
  await prisma.device.create({ data: { userId, label: `${NAME}'s phone`, pushToken: 'push-token' } });
  await prisma.otpCode.create({
    data: { userId, purpose: 'LOGIN', codeHash: 'x', expiresAt: new Date(Date.now() + 60_000), requestIp: '102.89.1.1' },
  });
  await prisma.loginAttempt.create({ data: { userId, identifier: PHONE, succeeded: true, ipAddress: '102.89.1.1' } });
  await prisma.loginAttempt.create({ data: { userId: null, identifier: PHONE, succeeded: false, ipAddress: '102.89.1.2' } });

  const version = await prisma.agreementVersion.create({
    data: { kind: 'PRIVACY_NOTICE', identifier: `PN-${userId.slice(0, 8)}`, title: 'Privacy', body: 'x', effectiveFrom: new Date('2026-01-01'), publishedBy: userId },
  });
  await prisma.agreementAcceptance.create({ data: { userId, versionId: version.id, ipAddress: '102.89.1.1', userAgent: 'Chrome' } });
  await prisma.consentRecord.create({ data: { userId, purpose: 'MARKETING', granted: false, note: `${NAME} does not want texts` } });
  await prisma.screeningResult.upsert({
    where: { userId },
    update: { notes: `Cleared: not the ${NAME} on the list` },
    create: { userId, status: 'CLEAR', screenedAt: new Date(), notes: `Cleared: not the ${NAME} on the list` },
  });

  await prisma.blockedPeriod.create({
    data: { userId, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 2 * 86_400_000), reason: `${NAME} is in hospital` },
  });
  await prisma.availabilitySlot.create({ data: { userId, kind: 'RECURRING_WEEKLY', dayOfWeek: 1, startMinute: 480, endMinute: 960 } });
  await prisma.notificationMessage.create({
    data: { userId, channel: 'sms', kind: 'offer', recipient: '+234803***0142', body: `Dear ${NAME}, you have been offered a shift`, sentAt: new Date() },
  });
  await prisma.securityEvent.create({ data: { userId, kind: 'login', detail: { phone: PHONE, ip: '102.89.1.1' } } });
  await prisma.suggestion.create({ data: { raisedBy: userId, area: 'SUPPORT', body: `From ${NAME}: please add a night filter` } });

  // A shift worked, invoiced and paid for, which erasure must leave alone.
  const assignment = await prisma.assignment.create({
    data: {
      serviceRequestId: world.requestId,
      userId,
      facilityId: world.facilityId,
      startsAt: new Date('2026-09-09T07:00:00Z'),
      endsAt: new Date('2026-09-09T15:00:00Z'),
      status: 'COMPLETED',
      confirmedBy: world.schedulerId,
    },
  });
  await prisma.ledgerEntry.createMany({
    data: [
      { transactionId: '00000000-0000-4000-8000-0000000000a1', account: 'FACILITY_PAYABLE', amountKobo: 4_000_000, subjectId: world.facilityId, memo: 'Approved shift' },
      { transactionId: '00000000-0000-4000-8000-0000000000a1', account: 'PRACTITIONER_EARNINGS', amountKobo: -4_000_000, subjectId: userId, memo: 'Approved shift' },
      { transactionId: '00000000-0000-4000-8000-0000000000a2', account: 'PRACTITIONER_EARNINGS', amountKobo: 4_000_000, subjectId: userId, memo: 'Payout' },
      { transactionId: '00000000-0000-4000-8000-0000000000a2', account: 'CASH', amountKobo: -4_000_000, subjectId: null, memo: 'Payout' },
    ],
  });
  await prisma.payout.create({ data: { practitionerId: userId, amountKobo: 4_000_000, status: 'SETTLED', settledAt: new Date() } });
  await prisma.auditLog.create({ data: { action: 'test.earlier_event', entityType: 'test', entityId: userId, actorId: userId } });

  const request = await raiseRequest({ userId, kind: 'ERASURE', detail: `Please delete me, ${NAME}, phone ${PHONE}` });
  const officer = await operator();
  await startRequest({ requestId: request.id, actorId: officer.id });

  return { world, userId, assignmentId: assignment.id, requestId: request.id, officerId: officer.id };
}

/** Every text or JSON column in every table this application owns that still holds the person's name, email or number. */
async function findLeaks(): Promise<string[]> {
  const columns = await prisma.$queryRaw<{ schema: string; table: string; column: string }[]>`
    SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS column
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema IN ('identity','audit','storage','practitioners','credentials','facilities',
           'availability','service_requests','matching','notifications','attendance','timesheets',
           'cancellations_sanctions','disputes','clinical_incidents','suggestions','rates','billing','consent')
       AND c.data_type IN ('text','character varying','json','jsonb','ARRAY')`;

  const leaks: string[] = [];
  for (const needle of ['Quillfeather', 'Zephyrine', 'zephyrine.q', PHONE_DIGITS]) {
    for (const { schema, table, column } of columns) {
      const found = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM "${schema}"."${table}" WHERE "${column}"::text ILIKE $1`,
        `%${needle}%`,
      );
      if (Number(found[0]!.n) > 0) leaks.push(`${schema}.${table}.${column} still holds "${needle}"`);
    }
  }
  return leaks;
}

describe('erasing a person', () => {
  it('replaces who they are, closes the account, and says so on the request', async () => {
    const s = await subject();

    const report = await executeErasure({ requestId: s.requestId, actorId: s.officerId });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(user.fullName).toBe('Erased user');
    expect(user.email).toBeNull();
    expect(user.phone).toBe(`erased-${s.userId}`);
    expect(user.passwordHash).toBeNull();
    expect(user.status).toBe('DEACTIVATED');
    expect(user.deletedAt).not.toBeNull();
    expect(user.phoneVerifiedAt).toBeNull();

    const request = await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: s.requestId } });
    expect(request.status).toBe('COMPLETED');
    expect(request.handledBy).toBe(s.officerId);
    expect(request.detail).toBeNull();
    expect(request.outcome).toContain('Erased');
    expect(report.retained.map((row) => row.area)).toEqual(
      expect.arrayContaining(['Audit trail', 'Invoices, ledger entries and payouts']),
    );
  });

  it('leaves no trace of their name, email or number in any table', async () => {
    const s = await subject();
    await executeErasure({ requestId: s.requestId, actorId: s.officerId });

    expect(await findLeaks()).toEqual([]);
  });

  it('(control) would have found them, so the scan above proves something', async () => {
    await subject();

    const leaks = await findLeaks();
    // The places the fixture put them: the account, notes, messages, requests...
    expect(leaks.length).toBeGreaterThanOrEqual(8);
    expect(leaks.join('\n')).toContain('identity.users.full_name');
    expect(leaks.join('\n')).toContain('notifications.messages.body');
  });

  it('ends every way of signing in, and the old number can no longer sign in', async () => {
    const s = await subject();
    await executeErasure({ requestId: s.requestId, actorId: s.officerId });

    expect(await prisma.session.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.device.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.otpCode.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.loginAttempt.count({ where: { identifier: PHONE } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: s.userId, revokedAt: null } })).toBe(0);
    await expect(login({ phone: PHONE, password: PASSWORD })).rejects.toThrow();
  });

  it('clears the professional record: profile, identity check, registration and credentials', async () => {
    const s = await subject();
    const before = await prisma.professionalRegistration.findFirstOrThrow({ where: { userId: s.userId } });

    await executeErasure({ requestId: s.requestId, actorId: s.officerId });

    const profile = await prisma.practitionerProfile.findUniqueOrThrow({ where: { userId: s.userId } });
    expect(profile.bio).toBeNull();
    expect(profile.photoObjectKey).toBeNull();
    expect(profile.homeStateId).toBeNull();
    expect(profile.deletedAt).not.toBeNull();
    expect(await prisma.identityVerification.count({ where: { userId: s.userId } })).toBe(0);
    const registration = await prisma.professionalRegistration.findFirstOrThrow({ where: { userId: s.userId } });
    expect(registration.folioNumber).not.toBe(before.folioNumber);
    expect(registration.folioNumber).toMatch(/^erased-/);
    expect(registration.deletedAt).not.toBeNull();
    const credentials = await prisma.credentialSubmission.findMany({ where: { userId: s.userId } });
    for (const row of credentials) {
      expect(row.referenceNumber).toBeNull();
      expect(row.documentObjectKey).toBeNull();
      expect(row.reviewNotes).toBeNull();
    }
  });

  it('deletes their files from storage, and records that it did', async () => {
    const s = await subject();

    const report = await executeErasure({ requestId: s.requestId, actorId: s.officerId });

    expect(deleteObject.mock.calls.map((call) => call[0]).sort()).toEqual([
      `credential/${s.userId}/licence.pdf`,
      `practitioner-photo/${s.userId}/me.jpg`,
    ]);
    expect(report.files).toEqual({ deleted: 2, pending: 0 });
    const objects = await prisma.storedObject.findMany({ where: { ownerUserId: s.userId } });
    expect(objects.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it('is not undone by a file that cannot be deleted: the data is gone, the file is reported, and a retry finishes it', async () => {
    const s = await subject();
    deleteObject.mockImplementation(async (key: string) => {
      if (key.includes('licence')) throw new Error('storage unavailable');
    });

    const first = await executeErasure({ requestId: s.requestId, actorId: s.officerId });
    expect(first.files).toEqual({ deleted: 1, pending: 1 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).fullName).toBe('Erased user');
    expect(
      (await prisma.storedObject.findMany({ where: { ownerUserId: s.userId, deletedAt: null } })).map(
        (row) => row.objectKey,
      ),
    ).toEqual([`credential/${s.userId}/licence.pdf`]);

    deleteObject.mockReset();
    deleteObject.mockResolvedValue(undefined);
    const retry = await executeErasure({ requestId: s.requestId, actorId: s.officerId });
    expect(retry.files).toEqual({ deleted: 1, pending: 0 });
    expect(await prisma.storedObject.count({ where: { ownerUserId: s.userId, deletedAt: null } })).toBe(0);
  });

  it('removes what they wrote or was sent to them, and keeps the record of what they agreed to', async () => {
    const s = await subject();
    await executeErasure({ requestId: s.requestId, actorId: s.officerId });

    expect(await prisma.notificationMessage.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.blockedPeriod.count({ where: { userId: s.userId } })).toBe(0);
    expect(await prisma.availabilitySlot.count({ where: { userId: s.userId } })).toBe(0);
    const suggestion = await prisma.suggestion.findFirstOrThrow();
    expect(suggestion.raisedBy).toBeNull();
    expect(suggestion.body).not.toContain('night filter');
    expect((await prisma.securityEvent.findFirstOrThrow({ where: { userId: s.userId } })).detail).toBeNull();
    // What they agreed to, and when, is evidence; what they wrote alongside it is not kept.
    const consent = await prisma.consentRecord.findFirstOrThrow({ where: { userId: s.userId } });
    expect(consent.granted).toBe(false);
    expect(consent.note).toBeNull();
    const acceptance = await prisma.agreementAcceptance.findFirstOrThrow({ where: { userId: s.userId } });
    expect(acceptance.ipAddress).toBeNull();
    expect(acceptance.userAgent).toBeNull();
    expect((await prisma.screeningResult.findUniqueOrThrow({ where: { userId: s.userId } })).notes).toBeNull();
  });

  it('keeps the shift, the money and the audit trail, which no longer name them', async () => {
    const s = await subject();
    const auditBefore = await prisma.auditLog.count();

    await executeErasure({ requestId: s.requestId, actorId: s.officerId });

    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: s.assignmentId } })).userId).toBe(s.userId);
    expect(await prisma.ledgerEntry.count({ where: { subjectId: s.userId } })).toBe(2);
    expect(await prisma.payout.count({ where: { practitionerId: s.userId } })).toBe(1);
    expect(await prisma.auditLog.count()).toBeGreaterThanOrEqual(auditBefore);
    expect(await prisma.auditLog.count({ where: { action: 'test.earlier_event' } })).toBe(1);
  });

  it('records that it happened, by whom, and how much, without who it was', async () => {
    const s = await subject();
    await executeErasure({ requestId: s.requestId, actorId: s.officerId });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'data_subject.erased' } });
    expect(audit.actorId).toBe(s.officerId);
    expect(audit.entityId).toBe(s.userId);
    expect(audit.after).toMatchObject({ requestId: s.requestId });
    const text = JSON.stringify(audit);
    expect(text).not.toContain('Quillfeather');
    expect(text).not.toContain(PHONE_DIGITS);
  });

  it('frees the number, so they or anybody else can register with it again', async () => {
    const s = await subject();
    await executeErasure({ requestId: s.requestId, actorId: s.officerId });

    expect(await prisma.user.count({ where: { phone: PHONE } })).toBe(0);
    const again = await prisma.user.create({ data: { phone: PHONE, fullName: 'New Person' } });
    expect(again.id).not.toBe(s.userId);
  });
});

describe('when erasure cannot go ahead', () => {
  async function untouched(userId: string) {
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).fullName).toBe(NAME);
    expect(deleteObject).not.toHaveBeenCalled();
  }

  it('waits while they are confirmed on a shift', async () => {
    const s = await subject();
    await prisma.assignment.update({ where: { id: s.assignmentId }, data: { status: 'CONFIRMED' } });

    await expect(executeErasure({ requestId: s.requestId, actorId: s.officerId })).rejects.toMatchObject({
      code: 'erasure_blocked',
      status: 409,
    });
    await untouched(s.userId);
    expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status).toBe('IN_PROGRESS');
  });

  it('waits while they are owed money', async () => {
    const s = await subject();
    await prisma.ledgerEntry.create({
      data: { transactionId: '00000000-0000-4000-8000-0000000000a3', account: 'PRACTITIONER_EARNINGS', amountKobo: -100_000, subjectId: s.userId, memo: 'Approved shift' },
    });

    await expect(executeErasure({ requestId: s.requestId, actorId: s.officerId })).rejects.toMatchObject({ code: 'erasure_blocked' });
    await untouched(s.userId);
  });

  it('waits while a dispute is open', async () => {
    const s = await subject();
    await prisma.dispute.create({
      data: { assignmentId: s.assignmentId, raisedBy: s.userId, raisedParty: 'PRACTITIONER', category: 'PAY', reason: 'The rate is wrong on my timesheet.', status: 'OPEN' },
    });

    await expect(executeErasure({ requestId: s.requestId, actorId: s.officerId })).rejects.toMatchObject({ code: 'erasure_blocked' });
    await untouched(s.userId);
  });

  it('will not erase somebody who works for a facility', async () => {
    const s = await subject();
    await grant({ userId: s.userId, roleKey: 'facility_administrator', permissions: ROLE_PERMISSIONS.facility_administrator ?? [], scopeType: 'FACILITY', scopeId: s.world.facilityId });

    await expect(executeErasure({ requestId: s.requestId, actorId: s.officerId })).rejects.toMatchObject({ code: 'erasure_staff_account', status: 409 });
    await untouched(s.userId);
  });

  it('will not act on a request that is not an erasure, or has not been picked up', async () => {
    const s = await subject();
    const access = await raiseRequest({ userId: s.userId, kind: 'ACCESS' });
    await startRequest({ requestId: access.id, actorId: s.officerId });
    const waiting = await raiseRequest({ userId: s.userId, kind: 'ERASURE' });

    await expect(executeErasure({ requestId: access.id, actorId: s.officerId })).rejects.toMatchObject({ code: 'not_an_erasure_request' });
    await expect(executeErasure({ requestId: waiting.id, actorId: s.officerId })).rejects.toMatchObject({ code: 'request_not_started' });
    await untouched(s.userId);
  });

  it('will not let an erasure be closed as done with words alone', async () => {
    // This was the gap: closing the request recorded that it was erased and
    // deleted nothing. Erasure is completed by carrying it out.
    const s = await subject();

    await expect(
      closeRequest({ requestId: s.requestId, actorId: s.officerId, status: 'COMPLETED', outcome: 'Erased the person.' }),
    ).rejects.toMatchObject({ code: 'erasure_must_be_carried_out', status: 409 });
    await untouched(s.userId);
    expect((await prisma.dataSubjectRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status).toBe('IN_PROGRESS');
  });

  it('still lets an erasure be refused, with the reason', async () => {
    const s = await subject();

    const refused = await closeRequest({
      requestId: s.requestId,
      actorId: s.officerId,
      status: 'REFUSED',
      outcome: 'Refused: the person is the subject of an open regulatory enquiry.',
    });

    expect(refused.status).toBe('REFUSED');
    await untouched(s.userId);
  });

  it('says so when there is no such request', async () => {
    const officer = await operator();
    await expect(
      executeErasure({ requestId: '00000000-0000-4000-8000-0000000000cc', actorId: officer.id }),
    ).rejects.toMatchObject({ code: 'request_not_found', status: 404 });
  });

  it('erases once when two officers press the button together', async () => {
    const s = await subject();

    const outcomes = await Promise.allSettled([
      executeErasure({ requestId: s.requestId, actorId: s.officerId }),
      executeErasure({ requestId: s.requestId, actorId: s.officerId }),
    ]);

    // One does it; the other finds it done and only has files to finish, of which none remain.
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditLog.count({ where: { action: 'data_subject.erased' } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).fullName).toBe('Erased user');
  });
});

describe('through the route', () => {
  const call = (requestId: string) =>
    eraseRoute(new Request(`http://localhost/api/v1/data-requests/${requestId}/erase`, { method: 'POST' }), {
      params: Promise.resolve({ id: requestId }),
    });

  it('needs a fresh password, and does nothing without one', async () => {
    const s = await subject();
    await issueSession({ userId: s.officerId });

    const response = await call(s.requestId);

    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('step_up_required');
    await expect(prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).resolves.toMatchObject({ fullName: NAME });
  });

  it('erases for an officer with a fresh session', async () => {
    const s = await subject();
    await issueSession({ userId: s.officerId, stepUp: true });

    const response = await call(s.requestId);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: { deleted: number } };
    expect(body.files.deleted).toBe(2);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).fullName).toBe('Erased user');
  });

  it('refuses somebody who is not entitled to', async () => {
    const s = await subject();
    const outsider = await createUser({ fullName: 'Facility Staff' });
    await grant({ userId: outsider.id, roleKey: 'facility_administrator', permissions: ROLE_PERMISSIONS.facility_administrator ?? [], scopeType: 'FACILITY', scopeId: s.world.facilityId });
    await issueSession({ userId: outsider.id, stepUp: true });

    expect((await call(s.requestId)).status).toBe(403);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).resolves.toMatchObject({ fullName: NAME });
  });
});
