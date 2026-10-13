import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { GET as platformRoute } from '@/app/api/v1/dashboard/platform/route';
import { GET as facilityRoute } from '@/app/api/v1/dashboard/facility/route';
import { GET as financeRoute } from '@/app/api/v1/dashboard/finance/route';
import { GET as practitionerRoute } from '@/app/api/v1/dashboard/practitioner/route';
import { GET as sessionRoute } from '@/app/api/v1/auth/session/route';
import { performanceReport, resetPerformanceStats } from '@/lib/http/timing';
import { financeSummary, listPlatformInvoices } from '@/modules/billing-settlement/application/finance-summary';
import { GET as financeInvoicesRoute } from '@/app/api/v1/finance/invoices/route';
import { issueSession } from '@/modules/auth/application/session-service';
import { platformSummary } from '@/modules/audit-compliance/application/platform-summary';
import { facilitySummary } from '@/modules/audit-compliance/application/facility-summary';
import { createFacility } from '@/modules/facilities/application/facility';
import { listFacilities } from '@/modules/facilities/application/facility';
import { submitSuggestion, listSuggestions } from '@/modules/suggestions/application/suggestion';
import { clearCookies } from './support/cookie-jar';
import {
  createFacilityType,
  createState,
  createUser,
  ensureRole,
  grant,
} from './support/fixtures';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';

/**
 * The dashboards' numbers, counted in the database.
 *
 * What matters is that a tile and the queue it links to cannot disagree, so the
 * counts are checked against the very list functions the queues use rather than
 * against a number typed here; and that a caller sees only the sections they
 * hold the permission for, because a summary is a second door onto the same
 * data.
 */

let sequence = 0;

async function pendingFacility(name: string) {
  await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
  const state = await createState();
  const facilityType = await createFacilityType();
  const representative = await createUser({ fullName: `Rep ${name}` });
  const ops = await createUser({ fullName: 'Operations Officer' });
  sequence += 1;
  return createFacility({
    name,
    facilityTypeId: facilityType.id,
    cacNumber: `RC${700_000 + sequence}`,
    stateId: state.id,
    addressLine: '1 Garden Close, Abuja',
    contactPhone: '+2348031234567',
    representativeUserId: representative.id,
    actorId: ops.id,
  });
}

async function get(route: (request: Request) => Promise<Response>, url: string) {
  const response = await route(new Request(url));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  clearCookies();
});

describe('the platform summary', () => {
  it('is all zeros, with no oldest date, on an empty platform', async () => {
    const all = new Set([
      'credential.review', 'facility.verify', 'incident.manage',
      'dispute.manage', 'sanction.apply', 'suggestion.triage',
    ]);
    const summary = await platformSummary(all);

    for (const queue of Object.values(summary.queues)) {
      expect(queue).toEqual({ count: 0, oldest: null });
    }
    expect(Object.keys(summary.queues)).toHaveLength(6);
    expect(summary.worstIncident).toBeNull();
  });

  it('counts what the queues list, and says when the oldest arrived', async () => {
    await pendingFacility('Abuja Central Clinic');
    await pendingFacility('Kano Road Clinic');
    const user = await createUser();
    await submitSuggestion({ userId: user.id, area: 'OTHER', body: 'The offers page should show the ward contact.' });

    const summary = await platformSummary(new Set(['facility.verify', 'suggestion.triage']));

    // Against the lists themselves, not a literal.
    const facilities = await listFacilities({ scopeType: 'PLATFORM', status: 'PENDING', limit: 200 });
    const suggestions = await listSuggestions({ status: 'NEW', limit: 100 });
    expect(summary.queues.facilities?.count).toBe(facilities.facilities.length);
    expect(summary.queues.facilities?.count).toBe(2);
    expect(summary.queues.suggestions?.count).toBe(suggestions.suggestions.length);
    expect(summary.queues.facilities?.oldest).toBeInstanceOf(Date);
  });

  it('shows only the sections the caller may open', async () => {
    await pendingFacility('Abuja Central Clinic');

    const summary = await platformSummary(new Set(['credential.review']));

    expect(Object.keys(summary.queues)).toEqual(['credentials']);
    expect(summary.queues.facilities).toBeUndefined();
    expect(summary.growth).toEqual([]);
    expect(summary.recent).toEqual([]);
  });

  it('buckets growth by month in one pass, and returns the latest activity', async () => {
    await pendingFacility('Abuja Central Clinic');

    const summary = await platformSummary(new Set(['facility.read', 'audit.read', 'practitioner.profile.read']));

    expect(summary.growth.length).toBeGreaterThan(0);
    const thisMonth = summary.growth.at(-1)!;
    expect(thisMonth.month).toMatch(/^\d{4}-\d{2}$/);
    expect(thisMonth.facilities).toBe(1);
    expect(thisMonth.usage).toBeGreaterThan(0);
    expect(summary.recent.length).toBeLessThanOrEqual(8);
    expect(summary.recent[0]?.action).toBeTruthy();
  });
});

describe('the platform summary route', () => {
  it('is refused to somebody who can open none of the queues', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });
    expect((await get(platformRoute, 'http://localhost/api/v1/dashboard/platform')).status).toBe(403);
  });

  it('is refused to somebody who is not signed in', async () => {
    expect((await get(platformRoute, 'http://localhost/api/v1/dashboard/platform')).status).toBe(401);
  });

  it('gives an officer only their own queues', async () => {
    await pendingFacility('Abuja Central Clinic');
    const officer = await createUser();
    await grant({
      userId: officer.id,
      roleKey: 'administrator',
      permissions: ['facility.verify'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: officer.id });

    const result = await get(platformRoute, 'http://localhost/api/v1/dashboard/platform');

    expect(result.status).toBe(200);
    expect(Object.keys(result.body.queues as object)).toEqual(['facilities']);
  });
});

describe('the facility summary', () => {
  it('counts a hospital’s own work and leaves out sections the caller does not hold', async () => {
    const facility = await pendingFacility('Abuja Central Clinic');

    const full = await facilitySummary(
      facility.id,
      new Set(['service_request.read', 'attendance.record', 'timesheet.approve', 'invoice.read']),
    );
    expect(full).toMatchObject({ published: 0, roster: 0, awaitingApproval: 0 });
    expect(full.fulfilment).toEqual([]);
    expect(full.spend).toEqual([]);

    const narrow = await facilitySummary(facility.id, new Set(['invoice.read']));
    expect(narrow.published).toBeUndefined();
    expect(narrow.roster).toBeUndefined();
    expect(narrow.spend).toEqual([]);
  });

  it('is refused for a hospital the caller does not belong to', async () => {
    const mine = await pendingFacility('Abuja Central Clinic');
    const theirs = await pendingFacility('Kano Road Clinic');
    const staff = await createUser();
    await grant({
      userId: staff.id,
      roleKey: 'facility_administrator',
      permissions: ['service_request.read', 'attendance.record', 'timesheet.approve', 'invoice.read'],
      scopeType: 'FACILITY',
      scopeId: mine.id,
    });
    await issueSession({ userId: staff.id });

    expect((await get(facilityRoute, `http://localhost/api/v1/dashboard/facility?facilityId=${mine.id}`)).status).toBe(200);
    expect((await get(facilityRoute, `http://localhost/api/v1/dashboard/facility?facilityId=${theirs.id}`)).status).toBe(403);
  });

  it('does not accept a missing or malformed facility id', async () => {
    const staff = await createUser();
    await issueSession({ userId: staff.id });
    const result = await get(facilityRoute, 'http://localhost/api/v1/dashboard/facility?facilityId=not-a-uuid');
    expect([400, 422]).toContain(result.status);
  });
});

describe('what a count may never hide', () => {
  it('reads the same facilities the verification queue reads, soft-deleted ones excluded', async () => {
    const kept = await pendingFacility('Abuja Central Clinic');
    const gone = await pendingFacility('Kano Road Clinic');
    await prisma.facility.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });

    const summary = await platformSummary(new Set(['facility.verify']));

    expect(summary.queues.facilities?.count).toBe(1);
    expect(kept.id).not.toBe(gone.id);
  });
});

describe('timing every guarded request', () => {
  it('puts Server-Timing on the response, counting raw SQL as queries too', async () => {
    const officer = await createUser();
    await grant({
      userId: officer.id,
      roleKey: 'administrator',
      permissions: ['invoice.read'],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: officer.id });

    const response = await financeRoute(new Request('http://localhost/api/v1/dashboard/finance'));
    const header = response.headers.get('server-timing') ?? '';

    expect(response.status).toBe(200);
    expect(header).toMatch(/total;dur=\d/);
    // Three raw aggregates plus the session and grants lookups: if raw queries
    // were not counted this would be the lookups alone.
    const queries = Number(/desc="(\d+) queries"/.exec(header)?.[1]);
    expect(queries).toBeGreaterThanOrEqual(5);
  });

  it('records the route for the performance report', async () => {
    resetPerformanceStats();
    const officer = await createUser();
    await grant({ userId: officer.id, roleKey: 'administrator', permissions: ['invoice.read'], scopeType: 'PLATFORM' });
    await issueSession({ userId: officer.id });
    await financeRoute(new Request('http://localhost/api/v1/dashboard/finance'));

    const row = performanceReport().routes.find((entry) => entry.route === 'GET /api/v1/dashboard/finance');
    expect(row?.count).toBe(1);
    expect(row?.meanQueries).toBeGreaterThan(0);
  });
});

describe('the finance endpoints', () => {
  it('are zero and empty on a platform with no invoices', async () => {
    expect(await financeSummary()).toEqual({
      totals: { outstandingKobo: 0, paidKobo: 0, draftKobo: 0, feesKobo: 0 },
      byMonth: [],
      byFacility: [],
    });
    expect(await listPlatformInvoices({ limit: 20 })).toEqual({ invoices: [], nextCursor: null });
  });

  it('are refused without invoice.read at platform scope', async () => {
    const user = await createUser();
    await issueSession({ userId: user.id });
    expect((await financeRoute(new Request('http://localhost/api/v1/dashboard/finance'))).status).toBe(403);
    expect((await financeInvoicesRoute(new Request('http://localhost/api/v1/finance/invoices'))).status).toBe(403);
  });

  it('refuse a malformed filter instead of passing it to the database', async () => {
    const officer = await createUser();
    await grant({ userId: officer.id, roleKey: 'administrator', permissions: ['invoice.read'], scopeType: 'PLATFORM' });
    await issueSession({ userId: officer.id });
    const bad = await financeInvoicesRoute(new Request('http://localhost/api/v1/finance/invoices?status=NOPE'));
    expect(bad.status).toBe(422);
    const tooBig = await financeInvoicesRoute(new Request('http://localhost/api/v1/finance/invoices?limit=100000'));
    expect(tooBig.status).toBe(422);
  });
});

describe('the practitioner overview', () => {
  it('is refused to somebody who holds none of its permissions, and to nobody signed in', async () => {
    expect((await get(practitionerRoute, 'http://localhost/api/v1/dashboard/practitioner')).status).toBe(401);

    const user = await createUser();
    await issueSession({ userId: user.id });
    expect((await get(practitionerRoute, 'http://localhost/api/v1/dashboard/practitioner')).status).toBe(403);
  });

  it('gives a newcomer a null profile rather than an error, and every section they may read', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'practitioner',
      permissions: ['practitioner.profile.read', 'availability.read', 'credential.document.read', 'service_request.read'],
      scopeType: 'SELF',
      scopeId: user.id,
    });
    await issueSession({ userId: user.id });

    const result = await get(practitionerRoute, 'http://localhost/api/v1/dashboard/practitioner');

    expect(result.status).toBe(200);
    expect(result.body.profile).toBeNull();
    expect(result.body.eligibility).toMatchObject({ eligible: false });
    expect(result.body.availability).toMatchObject({ slots: [], blocks: [] });
    expect(result.body.submissions).toEqual([]);
    expect(result.body.invitations).toEqual([]);
    expect(result.body.assignments).toEqual([]);
  });

  it('leaves out a section the caller may not read instead of refusing the whole overview', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'practitioner_narrow',
      permissions: ['availability.read'],
      scopeType: 'SELF',
      scopeId: user.id,
    });
    await issueSession({ userId: user.id });

    const result = await get(practitionerRoute, 'http://localhost/api/v1/dashboard/practitioner');

    expect(result.status).toBe(200);
    expect(Object.keys(result.body)).toEqual(['availability']);
  });
});

describe('the session the console starts from', () => {
  it('is the same answer whether the layout or the endpoint asks', async () => {
    const user = await createUser();
    await grant({
      userId: user.id,
      roleKey: 'practitioner',
      permissions: ['practitioner.profile.read', 'availability.read'],
      scopeType: 'SELF',
      scopeId: user.id,
    });
    await issueSession({ userId: user.id });

    const { sessionState } = await import('@/modules/auth/application/session-state');
    const direct = await sessionState();
    const viaRoute = await get(sessionRoute, 'http://localhost/api/v1/auth/session');

    expect(viaRoute.status).toBe(200);
    expect(JSON.parse(JSON.stringify(direct))).toEqual(viaRoute.body);
    expect(direct?.permissions).toEqual(['availability.read', 'practitioner.profile.read']);
  });

  it('is null, not an error, when nobody is signed in', async () => {
    const { sessionState } = await import('@/modules/auth/application/session-state');
    expect(await sessionState()).toBeNull();
    expect((await get(sessionRoute, 'http://localhost/api/v1/auth/session')).status).toBe(401);
  });
});
