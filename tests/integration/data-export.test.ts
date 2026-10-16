import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { issueSession } from '@/modules/auth/application/session-service';
import { raiseDispute, withdrawDispute } from '@/modules/disputes/application/dispute';
import { recordConsent } from '@/modules/audit-compliance/application/consent';
import { exportSubjectData } from '@/modules/audit-compliance/application/data-export';
import { raiseRequest } from '@/modules/audit-compliance/application/data-subject';
import { EXPORT_SECTIONS } from '@/modules/audit-compliance/domain/export-coverage';
import { GET as exportRoute } from '@/app/api/v1/me/export/route';
import { clearCookies } from './support/cookie-jar';
import { approved, buildWorld, type World } from './support/dispute-world';
import { createUser, grant } from './support/fixtures';

/**
 * M17-03 / AUD-07 / AUD-08 — the export gives a person everything the platform
 * holds about them, gives it to nobody else, and is open to everyone who can
 * sign in, not only the practitioners it was first written for.
 *
 * Three things are asserted, because each fails differently. That every section
 * the inventory says should exist does, and holds what was put in it (a query
 * deleted or a column renamed empties a section quietly). That no other person's
 * account id, words or secrets are anywhere in what comes back, whoever the
 * person is. That the route is gated on a fresh password rather than on a
 * permission, and says so.
 */

beforeEach(() => {
  clearCookies();
});

/** Every uuid in a document that is some other person's account id. */
async function otherPeopleIn(document: unknown, subjectId: string): Promise<string[]> {
  const found = new Set(
    (JSON.stringify(document).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []).map(
      (id) => id.toLowerCase(),
    ),
  );
  const users = await prisma.user.findMany({ select: { id: true } });
  return users.map((user) => user.id).filter((id) => id !== subjectId && found.has(id.toLowerCase()));
}

function size(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  return 1;
}

interface Planted {
  world: World;
  stranger: { id: string; phone: string };
  sessionHash: string;
  deviceToken: string;
  objectKey: string;
  hospitalDisputeId: string;
}

/**
 * One practitioner with something in every table the inventory says is about
 * them, a hospital that worked with them, and a stranger with rows of their own
 * that must never turn up in the practitioner's export.
 *
 * Direct inserts where the application path needs a bucket or a clock, because
 * the export reads tables, and what matters is which rows it picks up.
 */
async function plant(): Promise<Planted> {
  const world = await buildWorld();
  await approved(world);

  const practitioner = await prisma.user.findUniqueOrThrow({ where: { id: world.practitionerId } });
  await grant({
    userId: practitioner.id,
    roleKey: 'practitioner',
    permissions: ['practitioner.profile.read'],
    scopeType: 'SELF',
    scopeId: practitioner.id,
  });

  const stranger = await createUser({ fullName: 'Stranger Okeke' });
  await issueSession({
    userId: practitioner.id,
    ipAddress: '203.0.113.7',
    userAgent: 'MARK-A-BROWSER',
    stepUp: true,
  });
  const sessionRow = await prisma.session.findFirstOrThrow({ where: { userId: practitioner.id } });

  const deviceToken = 'PUSHTOKEN-SECRET-a1b2c3';
  await prisma.device.create({
    data: { userId: practitioner.id, label: 'MARK-A-PHONE', platform: 'android', pushToken: deviceToken },
  });
  await prisma.device.create({
    data: { userId: stranger.id, label: 'MARK-B-PHONE', platform: 'ios', pushToken: 'PUSHTOKEN-SECRET-zzz' },
  });
  await prisma.session.create({
    data: {
      userId: stranger.id,
      tokenHash: 'HASH-B-SESSION',
      ipAddress: '192.0.2.99',
      userAgent: 'MARK-B-BROWSER',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  await prisma.loginAttempt.createMany({
    data: [
      { identifier: practitioner.phone, succeeded: false, ipAddress: '198.51.100.9', reason: 'wrong_code' },
      { identifier: practitioner.phone, userId: practitioner.id, succeeded: true, ipAddress: '203.0.113.7' },
      { identifier: stranger.phone, userId: stranger.id, succeeded: true, ipAddress: '192.0.2.55' },
    ],
  });

  await prisma.screeningResult.create({
    data: {
      userId: practitioner.id,
      status: 'FLAGGED',
      matchedOn: 'name',
      screenedAt: new Date(),
      notes: 'MARK-A-SCREENING-NOTE',
    },
  });
  await prisma.screeningResult.create({
    data: { userId: stranger.id, status: 'CLEAR', screenedAt: new Date(), notes: 'MARK-B-SCREENING-NOTE' },
  });

  const objectKey = 'uploads/KEY-SECRET-a-licence.pdf';
  await prisma.storedObject.create({
    data: {
      bucket: 'medilink',
      objectKey,
      contentType: 'application/pdf',
      sizeBytes: 1234,
      purpose: 'credential_document',
      ownerUserId: practitioner.id,
      uploadedAt: new Date(),
    },
  });
  await prisma.storedObject.create({
    data: {
      bucket: 'medilink',
      objectKey: 'uploads/KEY-SECRET-b-licence.pdf',
      contentType: 'application/pdf',
      sizeBytes: 999,
      purpose: 'credential_document',
      ownerUserId: stranger.id,
      uploadedAt: new Date(),
    },
  });

  const assignment = await prisma.assignment.findUniqueOrThrow({ where: { id: world.assignmentId } });
  const run = await prisma.matchRun.create({
    data: {
      serviceRequestId: assignment.serviceRequestId,
      consideredCount: 2,
      rankedCount: 2,
      weights: {},
    },
  });
  await prisma.matchCandidate.createMany({
    data: [
      { matchRunId: run.id, userId: practitioner.id, rank: 1, score: 87.5, factors: [{ name: 'MARK-A-FACTOR', points: 10 }], exclusions: [] },
      { matchRunId: run.id, userId: stranger.id, rank: 2, score: 41.25, factors: [{ name: 'MARK-B-FACTOR', points: 3 }], exclusions: [] },
    ],
  });

  await prisma.availabilitySlot.create({
    data: {
      userId: practitioner.id,
      kind: 'RECURRING_WEEKLY',
      dayOfWeek: 2,
      startMinute: 480,
      endMinute: 960,
    },
  });
  await recordConsent({ userId: practitioner.id, purpose: 'MARKETING', granted: true, actorId: practitioner.id });
  await raiseRequest({ userId: practitioner.id, kind: 'ACCESS', detail: 'MARK-A-REQUEST-DETAIL' });

  // The practitioner disputes the hours, takes it back, and the hospital disputes them in turn.
  const own = await raiseDispute({
    assignmentId: world.assignmentId,
    actorId: practitioner.id,
    category: 'HOURS',
    reason: 'MARK-A-DISPUTE-REASON',
  });
  await prisma.disputeEvidence.create({
    data: { disputeId: own.id, objectKey: 'evidence/KEY-SECRET-own.jpg', attachedBy: practitioner.id, note: 'MARK-A-EVIDENCE-NOTE' },
  });
  await withdrawDispute({ disputeId: own.id, actorId: practitioner.id });
  const hospital = await raiseDispute({
    assignmentId: world.assignmentId,
    actorId: world.reviewerId,
    facilityId: world.facilityId,
    category: 'CONDUCT',
    reason: 'MARK-HOSPITAL-DISPUTE-REASON',
  });
  await prisma.disputeEvidence.create({
    data: { disputeId: hospital.id, objectKey: 'evidence/KEY-SECRET-hospital.jpg', attachedBy: world.reviewerId, note: 'MARK-HOSPITAL-EVIDENCE-NOTE' },
  });

  // One report by the practitioner, one by the hospital that names the practitioner.
  await prisma.clinicalIncident.create({
    data: {
      facilityId: world.facilityId,
      assignmentId: world.assignmentId,
      reportedBy: practitioner.id,
      occurredAt: new Date(Date.now() - 3_600_000),
      severity: 'NEAR_MISS',
      category: 'MEDICATION',
      summary: 'MARK-A-INCIDENT-I-REPORTED',
      closureNotes: 'MARK-CLOSURE-NOTE-ABOUT-REPORT',
    },
  });
  await prisma.clinicalIncident.create({
    data: {
      facilityId: world.facilityId,
      assignmentId: world.assignmentId,
      subjectUserId: practitioner.id,
      reportedBy: world.reviewerId,
      occurredAt: new Date(Date.now() - 7_200_000),
      severity: 'MODERATE',
      category: 'CONDUCT',
      summary: 'MARK-INCIDENT-NAMING-A',
    },
  });
  await prisma.accountSuspension.create({
    data: {
      userId: practitioner.id,
      reason: 'MARK-A-SUSPENSION-REASON',
      suspendedBy: world.officerId,
      liftedBy: world.officerId,
      liftedAt: new Date(),
      liftedReason: 'MARK-A-LIFTED-REASON',
    },
  });
  await prisma.excusal.create({
    data: { assignmentId: world.assignmentId, requestedBy: practitioner.id, reason: 'MARK-A-EXCUSAL', status: 'REFUSED', decidedBy: world.officerId, decidedAt: new Date(), decisionNotes: 'MARK-A-EXCUSAL-DECISION' },
  });
  await prisma.unhonouredAssignment.create({
    data: { assignmentId: world.assignmentId, shiftEndedAt: new Date(), status: 'CLOSED', fault: 'NEITHER', decidedBy: world.officerId, decidedAt: new Date(), reason: 'MARK-A-UNHONOURED-REASON' },
  });

  await prisma.notificationMessage.create({
    data: { userId: practitioner.id, channel: 'SMS', kind: 'timesheet.approved', recipient: '+234803***0001', body: 'MARK-A-MESSAGE', sentAt: new Date() },
  });
  await prisma.notificationMessage.create({
    data: { userId: stranger.id, channel: 'SMS', kind: 'timesheet.approved', recipient: '+234803***0002', body: 'MARK-B-MESSAGE', sentAt: new Date() },
  });
  await prisma.suggestion.create({ data: { raisedBy: practitioner.id, area: 'OTHER', body: 'MARK-A-SUGGESTION' } });
  await prisma.suggestion.create({ data: { raisedBy: stranger.id, area: 'OTHER', body: 'MARK-B-SUGGESTION' } });
  await prisma.securityEvent.create({ data: { userId: practitioner.id, kind: 'credential.document_accessed', detail: { note: 'MARK-A-EVENT' } } });
  await prisma.securityEvent.create({ data: { userId: stranger.id, kind: 'credential.document_accessed', detail: { note: 'MARK-B-EVENT' } } });

  const invoice = await prisma.invoice.create({
    data: {
      facilityId: world.facilityId,
      number: 'INV-EXPORT-0001',
      periodStart: new Date('2026-09-01'),
      periodEnd: new Date('2026-09-30'),
      grossKobo: 4_000_000,
      status: 'ISSUED',
      issuedAt: new Date(),
      createdBy: world.officerId,
      paymentReference: 'MARK-HOSPITAL-BANK-REF',
    },
  });
  await prisma.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      assignmentId: world.assignmentId,
      practitionerId: practitioner.id,
      hourlyRateKobo: 500_000,
      ordinaryMinutes: 480,
      nightMinutes: 0,
      holidayMinutes: 0,
      overtimeMinutes: 0,
      onCallMinutes: 0,
      baseKobo: 4_000_000,
      premiumKobo: 0,
      amountKobo: 4_000_000,
    },
  });

  return {
    world,
    stranger: { id: stranger.id, phone: stranger.phone },
    sessionHash: sessionRow.tokenHash,
    deviceToken,
    objectKey,
    hospitalDisputeId: hospital.id,
  };
}

describe('what the export holds', () => {
  it('returns exactly the sections the inventory promises, no more and no fewer', async () => {
    const { world } = await plant();
    const data = await exportSubjectData(world.practitionerId);

    expect(Object.keys(data).sort()).toEqual(['generatedAt', 'notIncluded', ...EXPORT_SECTIONS].sort());
  });

  it('fills every section that has something to hold', async () => {
    const { world } = await plant();
    const data = (await exportSubjectData(world.practitionerId)) as unknown as Record<string, unknown>;

    // Every section the practitioner has rows for. `credentials`, `professionalRegistrations`,
    // `identityVerification`, `profile`, `payouts` and `payoutAccounts` need a full onboarding
    // to fill and are exercised in the suites that build one.
    const filled = [
      'account',
      'devices',
      'sessions',
      'roles',
      'signInAttempts',
      'screening',
      'files',
      'invitations',
      'assignments',
      'assignmentHistory',
      'matchingScores',
      'attendance',
      'timesheets',
      'invoiceLines',
      'disputes',
      'incidentsYouReported',
      'suspensions',
      'excusals',
      'unhonouredShifts',
      'notifications',
      'suggestions',
      'securityEvents',
      'consent',
      'dataSubjectRequests',
    ];
    for (const key of filled) expect(size(data[key]), key).toBeGreaterThan(0);
    expect((data.availability as { slots: unknown[] }).slots.length).toBeGreaterThan(0);
  });

  it('says what happened on a shift: the times, who recorded them, what was approved', async () => {
    const { world } = await plant();
    const data = await exportSubjectData(world.practitionerId);

    const [attendance] = data.attendance;
    expect(attendance!.checkedInAt).toBeTruthy();
    expect(attendance!.events.length).toBeGreaterThan(0);
    // Recorded by the hospital's scheduler: said so, without naming them.
    expect(attendance!.events[0]!.recordedBy).toBe('someone else');
    expect(attendance!.events[0]!.reason).toMatch(/paper log/);

    const [timesheet] = data.timesheets;
    expect(timesheet!.billableMinutes).toBe(480);
    expect(timesheet!.amountKobo).toBe(4_000_000);
    expect(data.invoiceLines[0]).toMatchObject({ invoiceNumber: 'INV-EXPORT-0001', amountKobo: 4_000_000 });
    expect(data.assignmentHistory.length).toBeGreaterThan(0);
  });

  it('keeps what the hospital said about a dispute the person is party to, and says who said it', async () => {
    const { world } = await plant();
    const data = await exportSubjectData(world.practitionerId);

    const reasons = data.disputes.map((dispute) => dispute.reason);
    expect(reasons).toContain('MARK-A-DISPUTE-REASON');
    expect(reasons).toContain('MARK-HOSPITAL-DISPUTE-REASON');
    const own = data.disputes.find((dispute) => dispute.reason === 'MARK-A-DISPUTE-REASON')!;
    const theirs = data.disputes.find((dispute) => dispute.reason === 'MARK-HOSPITAL-DISPUTE-REASON')!;
    expect(own.raisedByYou).toBe(true);
    expect(theirs.raisedByYou).toBe(false);
    expect(own.evidence[0]).toMatchObject({ attachedBy: 'you', note: 'MARK-A-EVIDENCE-NOTE' });
    expect(theirs.evidence[0]).toMatchObject({ attachedBy: 'someone else' });
  });

  it('returns the incident the person reported, and not the one that names them', async () => {
    const { world } = await plant();
    const data = await exportSubjectData(world.practitionerId);
    const serialised = JSON.stringify(data);

    expect(data.incidentsYouReported).toHaveLength(1);
    expect(serialised).toContain('MARK-A-INCIDENT-I-REPORTED');
    expect(serialised).not.toContain('MARK-INCIDENT-NAMING-A');
    // What compliance wrote while closing the report is not the reporter's to receive.
    expect(serialised).not.toContain('MARK-CLOSURE-NOTE-ABOUT-REPORT');
    expect(data.notIncluded.incidentsAboutYou).toMatch(/names you/);
  });

  it('keeps the reasons for a suspension and its lifting, and not who decided', async () => {
    const { world } = await plant();
    const data = await exportSubjectData(world.practitionerId);

    expect(data.suspensions[0]).toMatchObject({
      reason: 'MARK-A-SUSPENSION-REASON',
      liftedReason: 'MARK-A-LIFTED-REASON',
    });
  });
});

describe('what the export keeps out', () => {
  it('contains no other person: not their account id, their words or their rows', async () => {
    const { world, stranger } = await plant();
    const data = await exportSubjectData(world.practitionerId);
    const serialised = JSON.stringify(data);

    expect(serialised).not.toMatch(/MARK-B-/);
    expect(serialised).not.toContain(stranger.phone);
    // The hospital's scheduler, ward manager and the officers all touched this shift.
    // Their account ids are not the subject's to receive; the export says "someone else".
    expect(await otherPeopleIn(data, world.practitionerId)).toEqual([]);
  });

  it('returns no secret: no token hash, push token, object key or the hospital\'s bank reference', async () => {
    const planted = await plant();
    const data = await exportSubjectData(planted.world.practitionerId);
    const serialised = JSON.stringify(data);

    expect(serialised).not.toContain(planted.sessionHash);
    expect(serialised).not.toContain(planted.deviceToken);
    expect(serialised).not.toMatch(/KEY-SECRET/);
    expect(serialised).not.toContain(planted.objectKey);
    expect(serialised).not.toMatch(/tokenHash|pushToken|objectKey|ninDigest/);
    // The hospital's invoice is the hospital's: the line says what the shift came to, not how it was paid.
    expect(serialised).not.toContain('MARK-HOSPITAL-BANK-REF');
    // Of the sign-in attempts: that they happened and whether they worked, not the address, which
    // for a failed one may be somebody else's.
    expect(serialised).not.toContain('198.51.100.9');
    expect(data.signInAttempts).toHaveLength(2);
  });

  it('gives a member of hospital staff their own data and not the practitioner\'s', async () => {
    const { world } = await plant();
    const data = await exportSubjectData(world.reviewerId);
    const serialised = JSON.stringify(data);

    expect(data.account.id).toBe(world.reviewerId);
    expect(data.roles.length).toBeGreaterThan(0);
    // The one dispute they raised, not the one the practitioner raised and withdrew.
    expect(data.disputes.map((dispute) => dispute.reason)).toEqual(['MARK-HOSPITAL-DISPUTE-REASON']);
    expect(data.disputes[0]!.raisedByYou).toBe(true);
    expect(data.disputes[0]!.evidence[0]).toMatchObject({ attachedBy: 'you', note: 'MARK-HOSPITAL-EVIDENCE-NOTE' });
    // Their own report, in their words, with the practitioner it names left unnamed.
    expect(data.incidentsYouReported).toHaveLength(1);
    expect(data.incidentsYouReported[0]).toMatchObject({ summary: 'MARK-INCIDENT-NAMING-A', namedAPractitioner: true });
    expect(serialised).not.toMatch(/MARK-A-/);
    expect(await otherPeopleIn(data, world.reviewerId)).toEqual([]);
    // Nothing of a practitioner's: they have no shifts, no timesheets and no screening.
    expect(data.assignments).toHaveLength(0);
    expect(data.timesheets).toHaveLength(0);
  });
});

describe('GET /api/v1/me/export', () => {
  async function signInAs(userId: string, options: { stepUp: boolean }) {
    clearCookies();
    await issueSession({ userId, stepUp: options.stepUp });
  }

  const call = () => exportRoute(new Request('http://localhost/api/v1/me/export'));

  it('is refused to somebody not signed in', async () => {
    const response = await call();
    expect(response.status).toBe(401);
  });

  it('asks for the password again, however long the session has been open', async () => {
    const { world } = await plant();
    await signInAs(world.practitionerId, { stepUp: false });

    const response = await call();
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('step_up_required');
  });

  it('hands a member of hospital staff their own export, on a fresh password', async () => {
    const { world } = await plant();
    // The ward manager holds no practitioner permission at all.
    await signInAs(world.reviewerId, { stepUp: true });

    const response = await call();
    const data = (await response.json()) as { account: { id: string } };

    expect(response.status).toBe(200);
    expect(data.account.id).toBe(world.reviewerId);
  });

  it('is never kept by a browser or a proxy', async () => {
    const { world } = await plant();
    await signInAs(world.practitionerId, { stepUp: true });

    const response = await call();

    expect(response.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('cannot be pointed at somebody else', async () => {
    const { world, stranger } = await plant();
    await signInAs(world.practitionerId, { stepUp: true });

    const response = await exportRoute(
      new Request(`http://localhost/api/v1/me/export?userId=${stranger.id}&id=${stranger.id}`),
    );
    const data = (await response.json()) as { account: { id: string } };

    expect(response.status).toBe(200);
    expect(data.account.id).toBe(world.practitionerId);
    expect(JSON.stringify(data)).not.toMatch(/MARK-B-/);
  });

  it('leaves a record that it was made, and sends nothing if the record cannot be written', async () => {
    const { world } = await plant();
    await signInAs(world.practitionerId, { stepUp: true });

    const response = await call();
    expect(response.status).toBe(200);

    const events = await prisma.securityEvent.findMany({
      where: { userId: world.practitionerId, kind: 'data_subject.export_generated' },
    });
    expect(events).toHaveLength(1);
    // What was exported is not in the record of its being exported.
    expect(JSON.stringify(events[0]!.detail)).not.toMatch(/MARK-A-/);

    const spy = vi.spyOn(prisma.securityEvent, 'create').mockRejectedValueOnce(new Error('disk full'));
    const refused = await call();
    spy.mockRestore();
    expect(refused.status).toBe(500);
    expect(JSON.stringify(await refused.json())).not.toMatch(/MARK-A-/);
  });
});
