import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { GET as getVerification } from '@/app/api/v1/practitioners/verification/route';
import { POST as postIdentity } from '@/app/api/v1/practitioners/verification/identity/route';
import { POST as postRegistration } from '@/app/api/v1/practitioners/verification/registration/route';
import { ROUTES } from '@/modules/practitioners/routes';
import { issueSession } from '@/modules/auth/application/session-service';
import { hashNin } from '@/modules/practitioners/domain/verification';
import { clearCookies } from './support/cookie-jar';
import { createUser, grant } from './support/fixtures';
import { APP_SCHEMAS } from './support/schemas';

/**
 * Steps 5.3, 5.4 and 5.5 — identity, uniqueness and what the regulator says.
 *
 * All of it runs with NIN and MDCN verification switched off, which is the
 * default and the only mode this project can run in until the subscriptions
 * are bought. That is the point: the manual path is the product, not a
 * stand-in for tests.
 */

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

const NIN = '12345678901';

async function post(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
): Promise<ApiResult> {
  const response = await handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

const callIdentity = (body: unknown) =>
  post(postIdentity, '/api/v1/practitioners/verification/identity', body);

const callRegistration = (body: unknown) =>
  post(postRegistration, '/api/v1/practitioners/verification/registration', body);

async function callGet(query: Record<string, string>): Promise<ApiResult> {
  const params = new URLSearchParams(query);
  const response = await getVerification(
    new Request(`http://localhost/api/v1/practitioners/verification?${params}`),
  );
  return { status: response.status, body: await response.json() };
}

async function complianceOfficer() {
  const officer = await createUser({ fullName: 'Compliance Officer' });
  await grant({
    userId: officer.id,
    roleKey: 'compliance_officer',
    permissions: ['credential.review', 'practitioner.profile.read'],
    scopeType: 'PLATFORM',
  });
  await issueSession({ userId: officer.id });
  return officer;
}

async function practitioner(fullName = 'Amina Yusuf') {
  const user = await createUser({ fullName });
  await grant({
    userId: user.id,
    roleKey: 'practitioner',
    permissions: ['practitioner.profile.read'],
    scopeType: 'SELF',
    scopeId: user.id,
  });
  return user;
}

const REGISTRATION = {
  regulator: 'MDCN',
  folioNumber: 'MDCN/R/12345',
  registrationStatus: 'ACTIVE' as const,
  practiceType: 'Full',
  location: 'Owerri, Imo',
};

beforeEach(() => {
  clearCookies();
});

describe('step 5.3 — recording an identity', () => {
  it('records the digest and the last four, never the number', async () => {
    const user = await practitioner();
    const officer = await complianceOfficer();

    const result = await callIdentity({ userId: user.id, nin: NIN, nameMatch: true });

    expect(result.status).toBe(201);
    expect(result.body.ninLast4).toBe('8901');
    expect(result.body.method).toBe('MANUAL');
    expect(result.body.verifiedBy).toBe(officer.id);
    // The number itself is not in the response, under any key.
    expect(JSON.stringify(result.body)).not.toContain(NIN);

    const row = await prisma.identityVerification.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.ninHash).toBe(hashNin(NIN, env.SESSION_SECRET));
    expect(row.ninHash).not.toContain(NIN);
  });

  it('accepts a number however it was typed', async () => {
    const user = await practitioner();
    await complianceOfficer();

    await callIdentity({ userId: user.id, nin: '123-4567-8901', nameMatch: true });

    const row = await prisma.identityVerification.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.ninHash).toBe(hashNin(NIN, env.SESSION_SECRET));
  });

  it('refuses a malformed number with a usable message', async () => {
    const user = await practitioner();
    await complianceOfficer();

    const result = await callIdentity({ userId: user.id, nin: '1234', nameMatch: true });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('refuses to assume the name matched', async () => {
    const user = await practitioner();
    await complianceOfficer();

    // With no provider configured, an officer read the slip. Defaulting this
    // to true would let a mismatched identity through silently.
    const result = await callIdentity({ userId: user.id, nin: NIN });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'name_match_required' } });
  });

  it('records a name mismatch rather than refusing it', async () => {
    const user = await practitioner();
    await complianceOfficer();

    // A mismatch is a finding for the eligibility rule to act on, not an
    // error — the officer still needs to record what they saw.
    const result = await callIdentity({ userId: user.id, nin: NIN, nameMatch: false });

    expect(result.status).toBe(201);
    expect(result.body.nameMatch).toBe(false);
  });
});

describe('step 5.4 — uniqueness at the database level', () => {
  it('refuses the same NIN on a second account, on the constraint', async () => {
    const first = await practitioner('Amina Yusuf');
    const second = await practitioner('Someone Else');
    await complianceOfficer();

    expect((await callIdentity({ userId: first.id, nin: NIN, nameMatch: true })).status).toBe(201);

    const duplicate = await callIdentity({ userId: second.id, nin: NIN, nameMatch: true });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ error: { code: 'duplicate_nin' } });
    expect(await prisma.identityVerification.count()).toBe(1);
  });

  it('lets the same practitioner have their own record corrected', async () => {
    const user = await practitioner();
    await complianceOfficer();

    await callIdentity({ userId: user.id, nin: NIN, nameMatch: false });
    const corrected = await callIdentity({ userId: user.id, nin: NIN, nameMatch: true });

    expect(corrected.status).toBe(201);
    expect(corrected.body.nameMatch).toBe(true);
    expect(await prisma.identityVerification.count()).toBe(1);
  });

  it('refuses the same folio number on a second account', async () => {
    const first = await practitioner();
    const second = await practitioner('Someone Else');
    await complianceOfficer();

    expect((await callRegistration({ userId: first.id, ...REGISTRATION })).status).toBe(201);

    const duplicate = await callRegistration({ userId: second.id, ...REGISTRATION });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ error: { code: 'duplicate_folio_number' } });
  });

  it('treats differently typed folio numbers as the same folio', async () => {
    const first = await practitioner();
    const second = await practitioner('Someone Else');
    await complianceOfficer();

    await callRegistration({ userId: first.id, ...REGISTRATION });
    const duplicate = await callRegistration({
      userId: second.id,
      ...REGISTRATION,
      folioNumber: ' mdcn/r/ 12345 ',
    });

    expect(duplicate.status).toBe(409);
  });
});

describe('step 5.5 — what the regulator showed, and when', () => {
  it('records the status, the evidence date and whether it is usable', async () => {
    const user = await practitioner();
    const officer = await complianceOfficer();

    const result = await callRegistration({ userId: user.id, ...REGISTRATION });

    expect(result.status).toBe(201);
    expect(result.body.registrationStatus).toBe('ACTIVE');
    expect(result.body.source).toBe('MANUAL');
    expect(result.body.recordedBy).toBe(officer.id);
    expect(result.body.usable).toBe(true);
    expect(result.body.evidenceRetrievedAt).not.toBeNull();
  });

  it('refuses to assume the register said ACTIVE', async () => {
    const user = await practitioner();
    await complianceOfficer();

    // Assuming the status would be assuming the answer to the only question
    // this record exists to ask.
    const result = await callRegistration({
      userId: user.id,
      regulator: 'MDCN',
      folioNumber: 'MDCN/R/99999',
    });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: 'registration_status_required' } });
  });

  it.each(['SUSPENDED', 'STRUCK_OFF', 'UNKNOWN'] as const)(
    'records %s as not usable',
    async (registrationStatus) => {
      const user = await practitioner();
      await complianceOfficer();

      const result = await callRegistration({ userId: user.id, ...REGISTRATION, registrationStatus });

      expect(result.body.registrationStatus).toBe(registrationStatus);
      expect(result.body.usable).toBe(false);
    },
  );

  it('marks a lapsed licence unusable even while its status says ACTIVE', async () => {
    const user = await practitioner();
    await complianceOfficer();

    const result = await callRegistration({
      userId: user.id,
      ...REGISTRATION,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });

    expect(result.body.registrationStatus).toBe('ACTIVE');
    expect(result.body.usable).toBe(false);
  });

  it('updates the existing registration rather than adding a second for the regulator', async () => {
    const user = await practitioner();
    await complianceOfficer();

    await callRegistration({ userId: user.id, ...REGISTRATION });
    const updated = await callRegistration({
      userId: user.id,
      ...REGISTRATION,
      registrationStatus: 'SUSPENDED',
    });

    // A doctor holds one MDCN folio, not a history of rows to reconcile; the
    // audit trail is what carries the history.
    expect(updated.status).toBe(201);
    expect(await prisma.professionalRegistration.count({ where: { userId: user.id } })).toBe(1);
    expect(updated.body.registrationStatus).toBe('SUSPENDED');
  });
});

describe('reading it back', () => {
  it('lets a practitioner see their own record, without the number', async () => {
    const user = await practitioner();
    await complianceOfficer();
    await callIdentity({ userId: user.id, nin: NIN, nameMatch: true });
    await callRegistration({ userId: user.id, ...REGISTRATION });

    await issueSession({ userId: user.id });
    const own = await callGet({ scopeType: 'SELF' });

    expect(own.status).toBe(200);
    expect((own.body.identity as { ninLast4: string }).ninLast4).toBe('8901');
    expect(own.body.registrations).toHaveLength(1);
    expect(JSON.stringify(own.body)).not.toContain(NIN);
  });

  it("refuses a practitioner another practitioner's record", async () => {
    const user = await practitioner();
    const other = await practitioner('Someone Else');
    await issueSession({ userId: user.id });

    expect((await callGet({ scopeType: 'SELF', scopeId: other.id })).status).toBe(403);
    expect((await callGet({ scopeType: 'PLATFORM', scopeId: other.id })).status).toBe(403);
  });

  it('refuses a practitioner the right to record their own identity', async () => {
    const user = await practitioner();
    await issueSession({ userId: user.id });

    // Verifying yourself is exactly what this step exists to prevent.
    expect((await callIdentity({ userId: user.id, nin: NIN, nameMatch: true })).status).toBe(403);
    expect((await callRegistration({ userId: user.id, ...REGISTRATION })).status).toBe(403);
  });
});

describe('the raw NIN never lands anywhere', () => {
  it('has no column named for a national identifier', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = ANY(${[...APP_SCHEMAS]}::text[])
         AND column_name IN ('nin', 'bvn', 'national_identification_number', 'nin_plain')
    `;

    // Step 5.3: "an automated scan asserts no raw NIN column". nin_hash and
    // nin_last4 are deliberately not on that list — neither is the number.
    expect(rows).toEqual([]);
  });

  it('does not write the number into the audit trail', async () => {
    const user = await practitioner();
    await complianceOfficer();
    await callIdentity({ userId: user.id, nin: NIN, nameMatch: true });

    const audited = await prisma.auditLog.findMany({
      where: { action: 'practitioner.identity_verified' },
    });
    expect(audited).toHaveLength(1);

    // The audit trail is append-only and read by more people than the record
    // itself: a NIN written here could never be taken back out.
    expect(JSON.stringify(audited)).not.toContain(NIN);
    expect(JSON.stringify(audited)).toContain('8901');
  });
});

describe('the route table', () => {
  it('keeps recording PLATFORM-only and reading available at both scopes', () => {
    const recording = ROUTES.filter((route) => route.path.includes('/verification/'));
    expect(recording.length).toBeGreaterThan(0);
    expect(recording.every((route) => route.scopeType === 'PLATFORM')).toBe(true);
    expect(recording.every((route) => route.permission === 'credential.review')).toBe(true);

    const reading = ROUTES.filter(
      (route) => route.path === '/api/v1/practitioners/verification' && route.method === 'GET',
    );
    expect(new Set(reading.map((route) => route.scopeType))).toEqual(new Set(['SELF', 'PLATFORM']));
  });
});
