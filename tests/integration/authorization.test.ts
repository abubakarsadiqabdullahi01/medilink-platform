import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { GET } from '@/app/api/v1/audit/route';
import { ROUTES } from '@/modules/audit-compliance/routes';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { createUser, grant, seedAuditRow } from './support/fixtures';

/**
 * Stage 4.3 and 4.4 — authorisation by permission *and* scope, asserted on a
 * real endpoint rather than on the decision function alone.
 *
 * The unit tests in src/lib/authz prove isAuthorized() decides correctly. They
 * cannot prove any endpoint asks it. Until this file, nothing in the codebase
 * called requirePermission at all: the guard was complete, tested, and wired
 * to nothing.
 *
 * Step 4.3 is done when "request as a user with the role but not the
 * permission asserts 403"; step 4.4 when "facility A administrator requests
 * facility B data, asserts 403". Both are below.
 */

const FACILITY_A = '00000000-0000-4000-8000-0000000000a1';
const FACILITY_B = '00000000-0000-4000-8000-0000000000b2';

async function get(query: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const params = new URLSearchParams(query);
  const response = await GET(new Request(`http://localhost/api/v1/audit?${params}`));
  return { status: response.status, body: await response.json() };
}

function entries(body: unknown): { id: string; action: string; scopeId: string | null }[] {
  return (body as { entries: { id: string; action: string; scopeId: string | null }[] }).entries;
}

beforeEach(() => {
  clearCookies();
});

describe('a caller without a session', () => {
  it('is told to sign in rather than that it lacks a permission', async () => {
    const { status, body } = await get({ scopeType: 'PLATFORM' });

    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: 'not_authenticated' } });
  });

  it('is refused once the session is revoked', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'compliance_officer',
      permissions: ['audit.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: user.id });

    expect((await get({ scopeType: 'PLATFORM' })).status).toBe(200);

    await prisma.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });

    expect((await get({ scopeType: 'PLATFORM' })).status).toBe(401);
  });

  it('is refused once the account is suspended', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'compliance_officer',
      permissions: ['audit.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: user.id });

    // Section 9: a suspension must stop access immediately, which is why
    // sessions are rows rather than JWTs.
    await prisma.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });

    expect((await get({ scopeType: 'PLATFORM' })).status).toBe(401);
  });
});

describe('step 4.3 — the role is not the permission', () => {
  it('refuses a user who holds a role without audit.read', async () => {
    const user = await createUser();
    // A real role with real permissions — just not this one. Authorisation
    // that asked "is this user a facility administrator?" would let it past.
    await grant({
      userId: user.id,
      roleKey: 'facility_administrator',
      permissions: ['facility.read', 'facility.write', 'facility.user.manage'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: user.id });

    const { status, body } = await get({ scopeType: 'PLATFORM' });

    expect(status).toBe(403);
    expect(body).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('refuses a user with no grant at all', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });

    expect((await get({ scopeType: 'PLATFORM' })).status).toBe(403);
  });

  it('refuses a user whose grant has been revoked', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'compliance_officer',
      permissions: ['audit.read'],
      scopeType: 'PLATFORM',
      revoked: true,
    });
    await issueSession({ userId: user.id });

    expect((await get({ scopeType: 'PLATFORM' })).status).toBe(403);
  });

  it('allows a user who holds the permission', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'compliance_officer',
      permissions: ['audit.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: user.id });

    expect((await get({ scopeType: 'PLATFORM' })).status).toBe(200);
  });
});

describe('step 4.4 — the grant is not enough without the scope', () => {
  beforeEach(async () => {
    await seedAuditRow({ action: 'facility.a.change', scopeType: 'FACILITY', scopeId: FACILITY_A });
    await seedAuditRow({ action: 'facility.b.change', scopeType: 'FACILITY', scopeId: FACILITY_B });
  });

  it("refuses facility A's administrator the records of facility B", async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'facility_compliance',
      permissions: ['audit.read'],
      scopeType: 'FACILITY',
      scopeId: FACILITY_A,
    });
    await issueSession({ userId: user.id });

    expect((await get({ scopeType: 'FACILITY', scopeId: FACILITY_A })).status).toBe(200);
    expect((await get({ scopeType: 'FACILITY', scopeId: FACILITY_B })).status).toBe(403);
  });

  it('refuses a facility-scoped grant the platform-wide view', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'facility_compliance',
      permissions: ['audit.read'],
      scopeType: 'FACILITY',
      scopeId: FACILITY_A,
    });
    await issueSession({ userId: user.id });

    // Widening the scope is the obvious way around a scoped grant, so it is
    // the one worth an explicit test.
    expect((await get({ scopeType: 'PLATFORM' })).status).toBe(403);
  });

  it('returns only the granted scope, not merely a 403 on the other one', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'facility_compliance',
      permissions: ['audit.read'],
      scopeType: 'FACILITY',
      scopeId: FACILITY_A,
    });
    await issueSession({ userId: user.id });

    const { body } = await get({ scopeType: 'FACILITY', scopeId: FACILITY_A });
    const rows = entries(body);

    // A status code proves the check ran; the rows prove the filter matches
    // what was authorised. Authorising one scope and querying a wider one
    // returns a 200 and the wrong data.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('facility.a.change');
    expect(rows.every((row) => row.scopeId === FACILITY_A)).toBe(true);
  });

  it('lets a platform grant reach every scope', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'compliance_officer',
      permissions: ['audit.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: user.id });

    expect((await get({ scopeType: 'FACILITY', scopeId: FACILITY_A })).status).toBe(200);
    expect((await get({ scopeType: 'FACILITY', scopeId: FACILITY_B })).status).toBe(200);
    expect(entries((await get({ scopeType: 'PLATFORM' })).body).length).toBeGreaterThanOrEqual(2);
  });
});

describe('SELF scope', () => {
  it('reaches the caller’s own records and no one else’s', async () => {
    const owner = await createUser();
    const other = await createUser();
    await seedAuditRow({
      action: 'auth.password_set',
      actorId: owner.id,
      scopeType: 'SELF',
      scopeId: owner.id,
    });
    await seedAuditRow({
      action: 'auth.password_set',
      actorId: other.id,
      scopeType: 'SELF',
      scopeId: other.id,
    });

    await grant({
      userId: owner.id,
      roleKey: 'practitioner',
      permissions: ['audit.read'],
      scopeType: 'SELF',
      scopeId: owner.id,
    });
    await issueSession({ userId: owner.id });

    const { status, body } = await get({ scopeType: 'SELF' });
    expect(status).toBe(200);

    const rows = entries(body);
    // Issuing the session above audits itself against the owner, so the count
    // is not fixed. What must hold is that nothing here belongs to anyone
    // else — the property, not an arithmetic coincidence.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.scopeId === owner.id)).toBe(true);
    expect(rows.some((row) => row.scopeId === other.id)).toBe(false);
  });

  it('refuses a scopeId naming someone else', async () => {
    const owner = await createUser();
    const other = await createUser();
    await seedAuditRow({ action: 'auth.password_set', scopeType: 'SELF', scopeId: other.id });

    await grant({
      userId: owner.id,
      roleKey: 'practitioner',
      permissions: ['audit.read'],
      scopeType: 'SELF',
      scopeId: owner.id,
    });
    await issueSession({ userId: owner.id });

    // Refused rather than quietly answered with the caller's own records: a
    // request for someone else's history is a different request, and the
    // guard's SELF check is what makes a self-scoped grant strictly self.
    expect((await get({ scopeType: 'SELF', scopeId: other.id })).status).toBe(403);
  });
});

describe('the endpoint itself', () => {
  beforeEach(async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'compliance_officer',
      permissions: ['audit.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: user.id });
  });

  it('rejects a scoped query with no scopeId before checking anything else', async () => {
    const { status, body } = await get({ scopeType: 'FACILITY' });

    expect(status).toBe(422);
    expect(body).toMatchObject({ error: { code: 'validation_failed' } });
  });

  it('rejects a scope type that is not one of the six', async () => {
    expect((await get({ scopeType: 'EVERYTHING' })).status).toBe(422);
  });

  it('never returns the before and after columns', async () => {
    await seedAuditRow({ action: 'user.suspended', scopeType: 'PLATFORM' });

    const rows = entries((await get({ scopeType: 'PLATFORM' })).body);

    // They hold the changed values. Redacted at write time, but still the
    // most sensitive column in the table and of no use to a list view.
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty('before');
      expect(row).not.toHaveProperty('after');
    }
  });

  it('pages without repeating a row', async () => {
    for (let index = 0; index < 5; index += 1) {
      await seedAuditRow({ action: `event.${index}`, scopeType: 'PLATFORM' });
    }

    const first = (await get({ scopeType: 'PLATFORM', limit: '2' })).body as {
      entries: { id: string }[];
      nextCursor: string | null;
    };
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = (
      await get({ scopeType: 'PLATFORM', limit: '2', cursor: first.nextCursor ?? '' })
    ).body as { entries: { id: string }[] };

    const firstIds = first.entries.map((row) => row.id);
    expect(second.entries.some((row) => firstIds.includes(row.id))).toBe(false);
  });

  it('records who read the trail', async () => {
    await get({ scopeType: 'PLATFORM' });

    const events = await prisma.securityEvent.findMany({ where: { kind: 'audit.trail_read' } });

    // Who conducted an investigation is a question asked afterwards, so it is
    // recorded at the time.
    expect(events).toHaveLength(1);
    expect(events[0]?.userId).not.toBeNull();
  });
});

describe('the route table', () => {
  it('lists the endpoint with the permission it enforces', () => {
    // The table is what a reviewer reads instead of every route file. If it
    // and the handler disagree, the table is the lie.
    expect(ROUTES.length).toBeGreaterThan(0);
    expect(ROUTES.every((route) => route.permission === 'audit.read')).toBe(true);
    expect(ROUTES.map((route) => route.scopeType)).toContain('FACILITY');
    expect(ROUTES.map((route) => route.scopeType)).toContain('PLATFORM');
  });
});
