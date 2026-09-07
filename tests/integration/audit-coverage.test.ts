import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import {
  AUDITED_MODELS,
  EXEMPT_MODELS,
  auditCoverageReport,
  describeCoverageFailure,
  startAuditCoverage,
  stopAuditCoverage,
} from '@/lib/audit-coverage';
import {
  setInitialPassword,
  startRegistration,
  verifyRegistrationPhone,
} from '@/modules/auth/application/registration';
import { login } from '@/modules/auth/application/login';
import { revokeSession } from '@/modules/auth/application/session-service';
import {
  confirmPasswordReset,
  requestPasswordReset,
} from '@/modules/auth/application/recovery';
import { clearCookies } from './support/cookie-jar';
import { lastOtpCode, startSmsCapture, stopSmsCapture } from './support/sms-capture';

/**
 * Stage 4.5 — "a test harness fails the suite if any write leaves no audit
 * row" (Implementation Plan, step 4.5).
 *
 * Two halves, and both are needed. The first drives the real services and
 * asserts the harness finds nothing; the second proves the harness would have
 * spoken up if there were something to find. A coverage check that cannot
 * fail reports success on an empty room.
 */

const PHONE = '08039990001';
const PASSWORD = 'kaduna-lantern-4471';
const REPLACEMENT_PASSWORD = 'jos-plateau-harmattan-88';

beforeEach(() => {
  clearCookies();
  startSmsCapture();
});

afterEach(() => {
  stopAuditCoverage();
  stopSmsCapture();
});

describe('audit coverage across the authentication journey', () => {
  it('leaves no state change without an audit row', async () => {
    startAuditCoverage();

    await startRegistration({ phone: PHONE, fullName: 'Amina Yusuf' });
    await verifyRegistrationPhone({ phone: PHONE, code: lastOtpCode() });
    const { userId } = await setInitialPassword({ phone: PHONE, password: PASSWORD });

    const session = await login({ phone: PHONE, password: PASSWORD });
    await revokeSession({ sessionId: session.sessionId, actorId: userId, reason: 'Signed out' });

    await requestPasswordReset({ phone: PHONE });
    await confirmPasswordReset({
      phone: PHONE,
      code: lastOtpCode(),
      password: REPLACEMENT_PASSWORD,
    });

    const report = auditCoverageReport();

    // Fail with the list, not with "expected 0 to be 1": the point of the
    // harness is to name the write that got away.
    expect(describeCoverageFailure(report)).toBeNull();

    // Guard against the journey silently doing nothing — an empty window
    // would also produce an empty list of unaudited writes.
    expect(report.writes.length).toBeGreaterThan(0);
    expect(report.audits.length).toBeGreaterThan(0);
  });

  it('records the journey in the audit trail in the order it happened', async () => {
    await startRegistration({ phone: PHONE, fullName: 'Amina Yusuf' });
    await verifyRegistrationPhone({ phone: PHONE, code: lastOtpCode() });
    await setInitialPassword({ phone: PHONE, password: PASSWORD });
    await login({ phone: PHONE, password: PASSWORD });

    const rows = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });

    expect(rows.map((row) => row.action)).toEqual([
      'auth.registration_started',
      'auth.otp_issued',
      'auth.phone_verified',
      'auth.password_set',
      'auth.session_issued',
    ]);
  });
});

describe('the harness itself', () => {
  it('reports a write that leaves no audit row', async () => {
    startAuditCoverage();

    // Exactly the mistake the harness exists to catch: a state change written
    // without the audit row that must accompany it.
    await prisma.user.create({
      data: { phone: '+2348039990002', fullName: 'Unaudited Write' },
    });

    const report = auditCoverageReport();

    expect(report.unaudited).toHaveLength(1);
    expect(report.unaudited[0]).toMatchObject({
      model: 'User',
      entityType: 'identity.users',
      action: 'create',
    });
    expect(describeCoverageFailure(report)).toContain('identity.users');
  });

  it('reports an audit row naming a table that does not exist', async () => {
    startAuditCoverage();

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { phone: '+2348039990003', fullName: 'Typo Entity' },
      });
      await recordAudit(tx, {
        action: 'user.created',
        entityType: 'identity.user', // singular — the table is identity.users
        entityId: user.id,
        actorId: user.id,
      });
    });

    const report = auditCoverageReport();

    expect(report.unknownEntityTypes).toEqual(['identity.user']);
    // The typo also means the write went unaccounted for, and both are said.
    expect(report.unaudited).toHaveLength(1);
    expect(describeCoverageFailure(report)).toContain('identity.user');
  });

  it('ignores a bulk write that matched nothing', async () => {
    startAuditCoverage();

    const result = await prisma.session.updateMany({
      where: { userId: '00000000-0000-0000-0000-000000000000' },
      data: { revokedAt: new Date() },
    });

    expect(result.count).toBe(0);
    // Nothing changed, so there is nothing to audit.
    expect(auditCoverageReport().writes).toHaveLength(0);
  });

  it('stops recording once the window closes', async () => {
    startAuditCoverage();
    stopAuditCoverage();

    await prisma.user.create({
      data: { phone: '+2348039990004', fullName: 'After The Window' },
    });

    expect(auditCoverageReport().writes).toHaveLength(0);
  });
});

describe('the audited-model registry', () => {
  it('accounts for every model in the schema', () => {
    const unclassified = Prisma.dmmf.datamodel.models
      .map((model) => model.name)
      .filter((name) => !(name in AUDITED_MODELS) && !(name in EXEMPT_MODELS));

    // A new model must be a deliberate decision: audited, or exempt with a
    // written reason. Adding one and saying nothing is what this catches.
    expect(unclassified).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    for (const [model, reason] of Object.entries(EXEMPT_MODELS)) {
      expect(reason.length, `${model} needs a reason for its exemption`).toBeGreaterThan(20);
    }
  });

  it('names tables that actually exist', async () => {
    const rows = await prisma.$queryRaw<{ qualified: string }[]>`
      SELECT format('%I.%I', schemaname, tablename) AS qualified
        FROM pg_tables
       WHERE schemaname IN ('identity', 'audit', 'config', 'storage')
    `;
    const existing = new Set(rows.map((row) => row.qualified));

    for (const [model, entityType] of Object.entries(AUDITED_MODELS)) {
      expect(existing.has(entityType), `${model} is mapped to missing table ${entityType}`).toBe(
        true,
      );
    }
  });
});
