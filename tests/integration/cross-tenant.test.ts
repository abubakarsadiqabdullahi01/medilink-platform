import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

// Only headObject touches the network; the ownership check that matters runs
// before it, against the stored-object row.
vi.mock('@/lib/storage/tigris', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/tigris')>();
  return { ...actual, headObject: vi.fn().mockResolvedValue({}) };
});

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { issueSession } from '@/modules/auth/application/session-service';
import { clearCookies } from './support/cookie-jar';
import { MUTABLE_SCHEMAS } from './support/schemas';
import { buildTenantWorld, type Tenant, type TenantWorld } from './support/tenant-world';

/**
 * AUT-10 — a caller from one hospital, and everything of another's they could
 * name.
 *
 * The permission guard proves a caller holds a permission over the scope they
 * *name*. Whether the record they name lies inside that scope is each route's
 * own business, and a route that forgets is invisible to every test that only
 * ever calls it as the rightful owner. AUT-01 was exactly that: the owner of one
 * hospital could revoke another's staff with a single identifier, for as long as
 * the product had existed, because nothing ever called the route as somebody
 * else.
 *
 * So this is a pattern rather than a patch. Every route that takes an
 * identifier is in the table below, with who attacks it and how, and a second
 * test fails when a route exists that the table does not mention — a new route
 * has to say whether it is isolated, in a file where the answer is reviewed.
 *
 * What each attack must come to:
 *
 *  - **refused, and only refused.** 403 or 404, nothing else. A 409 or a 422 is
 *    the route reaching the record and complaining about its state, which tells
 *    the caller the record exists in somebody else's hospital; and a 200 is the
 *    bug. A body that does not parse, which would also fail, is caught the same
 *    way rather than passing for the wrong reason.
 *  - **changed nothing.** A fingerprint of every mutable table, before and after.
 *  - **given nothing away.** The answer contains nothing of the other hospital.
 *
 * And for every attack there is a control: the rightful caller makes the same
 * request and is not refused. Without it, a test that built its request wrongly
 * would pass by being refused for the wrong reason.
 *
 * One world, many cases: the suite truncates between `it`s, and building two
 * hospitals is the expensive part. Failures are collected and asserted together
 * so one run names every route that leaks, not only the first.
 */

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Role = 'owner' | 'practitioner';

interface Req {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

interface Ctx {
  role: Role;
  /** Whose records the request is about. */
  t: Tenant;
  /** The facility a caller names when the route takes one in its input. */
  declare: string;
}

interface Case {
  route: string;
  method: Method;
  /** Who tries it, each from tenant A against tenant B's records. */
  attackers: Role[];
  /**
   * Who the rightful caller is. `same`: the same role in tenant B. `admin`: the
   * platform, for routes only the platform may call. `invitee`: the person an
   * invitation was sent to.
   */
  control: 'same' | 'admin' | 'invitee';
  /**
   * Who of the rightful side is let through, when that is fewer than the roles
   * that attack. The dispute routes guard on the caller's own scope, so a
   * hospital's owner cannot use them at all yet (DSP-04): attacking as one
   * proves a refusal, but the control is the practitioner who raised the case.
   */
  controlRoles?: Role[];
  /** The route takes a facility in its input: attack naming our own and naming theirs. */
  declares?: boolean;
  /** For platform routes: the record may legitimately be refused for its state or be absent. */
  lenientControl?: boolean;
  request: (ctx: Ctx) => Req;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const today = new Date().toISOString().slice(0, 10);

const onFacility = (
  route: string,
  method: Method,
  request: Case['request'],
  extra: Partial<Case> = {},
): Case => ({
  route,
  method,
  attackers: ['owner'],
  control: 'same',
  declares: true,
  request,
  ...extra,
});

const onSelf = (
  route: string,
  method: Method,
  request: Case['request'],
  extra: Partial<Case> = {},
): Case => ({
  route,
  method,
  attackers: ['practitioner'],
  control: 'same',
  request,
  ...extra,
});

/** Routes only the platform may call: a hospital's people hold no such permission. */
const onPlatform = (
  route: string,
  method: Method,
  request: Case['request'],
  extra: Partial<Case> = {},
): Case => ({
  route,
  method,
  attackers: ['owner', 'practitioner'],
  control: 'admin',
  lenientControl: true,
  request,
  ...extra,
});

/** The two sides of a shift reach it differently: a hospital by its facility, a practitioner as themselves. */
const scopeQuery = (c: Ctx): Record<string, string> =>
  c.role === 'owner' ? { scopeType: 'FACILITY', scopeId: c.declare } : { scopeType: 'SELF' };

const ID = (id: string) => ({ params: { id } });

const CASES: Case[] = [
  // ── attendance ────────────────────────────────────────────────────────────
  onFacility('assignments/[id]/attendance/manual', 'POST', (c) => ({
    ...ID(c.t.pastAssignmentId),
    body: {
      facilityId: c.declare,
      checkedInAt: iso(-3 * DAY),
      checkedOutAt: iso(-3 * DAY + 8 * HOUR),
      reason: 'The device was offline for the whole shift.',
    },
  })),
  onSelf(
    'assignments/[id]/attendance/present',
    'POST',
    (c) => ({
      ...ID(c.t.futureAssignmentId),
      body: { purpose: 'CHECK_IN', code: '123456' },
    }),
    { attackers: ['practitioner'], lenientControl: true },
  ),
  {
    route: 'assignments/[id]/attendance',
    method: 'GET',
    attackers: ['owner', 'practitioner'],
    control: 'same',
    declares: true,
    request: (c) => ({ ...ID(c.t.pastAssignmentId), query: scopeQuery(c) }),
  },
  onFacility('assignments/[id]/attendance/token', 'POST', (c) => ({
    ...ID(c.t.futureAssignmentId),
    body: { facilityId: c.declare, purpose: 'CHECK_IN' },
  })),

  // ── a booking, from the hospital's side and the practitioner's ───────────
  onFacility('assignments/[id]/cancel', 'POST', (c) => ({
    ...ID(c.t.futureAssignmentId),
    body: { facilityId: c.declare, reason: 'The rota changed and we no longer need cover.' },
  })),
  onFacility('assignments/[id]/timesheet/correct', 'POST', (c) => ({
    ...ID(c.t.pastAssignmentId),
    body: { facilityId: c.declare, reason: 'The break was not recorded.', breakMinutes: 30 },
  })),
  onFacility('assignments/[id]/timesheet/review', 'POST', (c) => ({
    ...ID(c.t.pastAssignmentId),
    body: { facilityId: c.declare, decision: 'approve' },
  })),
  {
    route: 'assignments/[id]/timesheet',
    method: 'GET',
    attackers: ['owner', 'practitioner'],
    control: 'same',
    declares: true,
    request: (c) => ({ ...ID(c.t.pastAssignmentId), query: scopeQuery(c) }),
  },
  onSelf(
    'assignments/[id]/timesheet/submit',
    'POST',
    (c) => ({ ...ID(c.t.pastAssignmentId), body: {} }),
    {
      lenientControl: true,
    },
  ),

  // ── disputes raised against a shift ──────────────────────────────────────
  // Against a shift whose hours are decided and which nobody has disputed: the
  // one state in which a dispute can be opened, so that a refusal is for who is
  // asking and not for what state the shift is in.
  onFacility('assignments/[id]/disputes', 'POST', (c) => ({
    ...ID(c.t.decidedAssignmentId),
    body: {
      facilityId: c.declare,
      category: 'HOURS',
      reason: 'The hours claimed are more than were worked.',
    },
  })),
  onSelf(
    'assignments/[id]/disputes',
    'POST',
    (c) => ({
      ...ID(c.t.decidedAssignmentId),
      body: { category: 'PAY', reason: 'I was paid for fewer hours than I worked.' },
    }),
    { control: 'invitee' },
  ),
  {
    route: 'assignments/[id]/disputes',
    method: 'GET',
    attackers: ['owner', 'practitioner'],
    control: 'same',
    declares: true,
    request: (c) => ({ ...ID(c.t.pastAssignmentId), query: scopeQuery(c) }),
  },

  // ── excusals and fault ───────────────────────────────────────────────────
  onSelf(
    'assignments/[id]/excusals',
    'POST',
    (c) => ({
      ...ID(c.t.noShowAssignmentId),
      body: { reason: 'I was in hospital that morning and could not call.' },
    }),
    { control: 'invitee', lenientControl: true },
  ),
  onSelf(
    'assignments/[id]/excusals',
    'GET',
    (c) => ({
      ...ID(c.t.noShowAssignmentId),
      query: { scopeType: 'SELF' },
    }),
    { control: 'invitee' },
  ),
  onPlatform('assignments/[id]/excusals', 'GET', (c) => ({
    ...ID(c.t.noShowAssignmentId),
    query: { scopeType: 'PLATFORM' },
  })),
  onPlatform('assignments/[id]/fault', 'POST', (c) => ({
    ...ID(c.t.noShowAssignmentId),
    body: { fault: 'NEITHER', reason: 'Nobody could have known the road was closed.' },
  })),
  onPlatform('excusals/[id]/decide', 'POST', (c) => ({
    ...ID(c.t.excusalId),
    body: { decision: 'grant' },
  })),

  // ── a practitioner's own availability ────────────────────────────────────
  onSelf('availability/blocks/[id]', 'DELETE', (c) => ID(c.t.blockId)),
  onSelf('availability/slots/[id]', 'DELETE', (c) => ID(c.t.slotId)),

  // ── credentials ──────────────────────────────────────────────────────────
  onSelf(
    'credentials/[id]/document-url',
    'POST',
    (c) => ({
      ...ID(c.t.credentialId),
      body: { scopeType: 'SELF' },
    }),
    { lenientControl: true },
  ),
  onPlatform('credentials/[id]/document-url', 'POST', (c) => ({
    ...ID(c.t.credentialId),
    body: { scopeType: 'PLATFORM' },
  })),
  onPlatform('credentials/[id]/review', 'POST', (c) => ({
    ...ID(c.t.credentialId),
    body: { decision: 'approve' },
  })),
  onSelf(
    'credentials/[id]',
    'PATCH',
    (c) => ({
      ...ID(c.t.credentialId),
      body: { referenceNumber: 'REPLACEMENT-1' },
    }),
    { lenientControl: true },
  ),

  // ── data-protection requests ─────────────────────────────────────────────
  onPlatform('data-requests/[id]/start', 'POST', (c) => ({ ...ID(c.t.dataRequestId), body: {} })),
  onPlatform('data-requests/[id]/close', 'POST', (c) => ({
    ...ID(c.t.dataRequestId),
    body: { status: 'COMPLETED', outcome: 'Everything we hold was sent to them by courier today.' },
  })),

  // ── dispute evidence and the case itself ─────────────────────────────────
  {
    route: 'disputes/[id]/evidence/[evidenceId]/url',
    method: 'POST',
    attackers: ['owner', 'practitioner'],
    controlRoles: ['practitioner'],
    control: 'same',
    lenientControl: true,
    request: (c) => ({ params: { id: c.t.disputeId, evidenceId: c.t.evidenceId }, body: {} }),
  },
  {
    route: 'disputes/[id]/evidence',
    method: 'POST',
    attackers: ['owner', 'practitioner'],
    controlRoles: ['practitioner'],
    control: 'same',
    lenientControl: true,
    request: (c) => ({
      ...ID(c.t.disputeId),
      body: { objectKey: `disputes/${c.t.disputeId}/extra.pdf`, note: 'Further evidence' },
    }),
  },
  onPlatform('disputes/[id]/evidence', 'GET', (c) => ID(c.t.disputeId)),
  {
    route: 'disputes/[id]/evidence/upload-url',
    method: 'POST',
    attackers: ['owner', 'practitioner'],
    controlRoles: ['practitioner'],
    control: 'same',
    lenientControl: true,
    request: (c) => ({
      ...ID(c.t.disputeId),
      body: { filename: 'rota.pdf', contentType: 'application/pdf', sizeBytes: 2048 },
    }),
  },
  onPlatform('disputes/[id]/resolve', 'POST', (c) => ({
    ...ID(c.t.disputeId),
    body: { outcome: 'UPHELD', notes: 'The hours were wrong on the timesheet.' },
  })),
  onPlatform('disputes/[id]/review', 'POST', (c) => ({ ...ID(c.t.disputeId), body: {} })),
  onPlatform('disputes/[id]', 'GET', (c) => ID(c.t.disputeId)),
  {
    route: 'disputes/[id]/withdraw',
    method: 'POST',
    attackers: ['owner', 'practitioner'],
    controlRoles: ['practitioner'],
    control: 'same',
    lenientControl: true,
    request: (c) => ({ ...ID(c.t.disputeId), body: {} }),
  },

  // ── facilities: the id in the path is the scope ──────────────────────────
  onFacility(
    'facilities/[id]/licence-upload-url',
    'POST',
    (c) => ({
      ...ID(c.t.facilityId),
      body: { filename: 'licence.pdf', contentType: 'application/pdf', sizeBytes: 2048 },
    }),
    { declares: false, lenientControl: true },
  ),
  onFacility('facilities/[id]/licence-url', 'POST', (c) => ({ ...ID(c.t.facilityId), body: {} }), {
    declares: false,
    lenientControl: true,
  }),
  onFacility('facilities/[id]', 'GET', (c) => ID(c.t.facilityId), { declares: false }),
  onFacility(
    'facilities/[id]',
    'PATCH',
    (c) => ({ ...ID(c.t.facilityId), body: { name: 'Hijacked Hospital' } }),
    {
      declares: false,
    },
  ),
  onPlatform('facilities/[id]/verify', 'POST', (c) => ({
    ...ID(c.t.facilityId),
    body: { decision: 'approve' },
  })),

  // ── access ───────────────────────────────────────────────────────────────
  onFacility('grants/[id]/revoke', 'POST', (c) => ({
    ...ID(c.t.staffGrantId),
    body: { scopeType: 'FACILITY', scopeId: c.declare, reason: 'Left the hospital in March.' },
  })),

  // ── incidents ────────────────────────────────────────────────────────────
  onPlatform('incidents/[id]/close', 'POST', (c) => ({
    ...ID(c.t.incidentId),
    body: {
      outcome: 'NO_ACTION',
      notes: 'Reviewed the chart and the shift record; no further action needed.',
    },
  })),
  onPlatform('incidents/[id]/review', 'POST', (c) => ({ ...ID(c.t.incidentId), body: {} })),
  onPlatform('incidents/[id]', 'GET', (c) => ID(c.t.incidentId)),
  onPlatform('users/[id]/reinstate', 'POST', (c) => ({
    ...ID(c.t.practitionerId),
    body: { reason: 'Reviewed and cleared by compliance.' },
  })),
  onPlatform('users/[id]/suspensions', 'GET', (c) => ID(c.t.practitionerId)),

  // ── invitations, matching and the shift itself ───────────────────────────
  onSelf(
    'invitations/[id]/respond',
    'POST',
    (c) => ({
      ...ID(c.t.invitationId),
      body: { decision: 'accept' },
    }),
    { control: 'invitee', lenientControl: true },
  ),
  onFacility('match-runs/[id]', 'GET', (c) => ({
    ...ID(c.t.matchRunId),
    query: { facilityId: c.declare },
  })),
  onFacility('service-requests/[id]/cancel', 'POST', (c) => ({
    ...ID(c.t.futureRequestId),
    body: { facilityId: c.declare, reason: 'The rota changed and we no longer need cover.' },
  })),
  onFacility(
    'service-requests/[id]/confirm',
    'POST',
    (c) => ({
      ...ID(c.t.futureRequestId),
      body: { facilityId: c.declare, userId: c.t.inviteeId },
    }),
    { lenientControl: true },
  ),
  onFacility('service-requests/[id]/invitations', 'GET', (c) => ({
    ...ID(c.t.futureRequestId),
    query: { facilityId: c.declare },
  })),
  onFacility(
    'service-requests/[id]/invite',
    'POST',
    (c) => ({
      ...ID(c.t.futureRequestId),
      body: { facilityId: c.declare, userIds: [c.t.inviteeId] },
    }),
    { lenientControl: true },
  ),
  onFacility('service-requests/[id]/match', 'POST', (c) => ({
    ...ID(c.t.futureRequestId),
    body: { facilityId: c.declare },
  })),
  onFacility('service-requests/[id]/publish', 'POST', (c) => ({
    ...ID(c.t.draftRequestId),
    body: { facilityId: c.declare },
  })),
  onFacility('service-requests/[id]', 'GET', (c) => ({
    ...ID(c.t.futureRequestId),
    query: { facilityId: c.declare },
  })),

  // ── money ────────────────────────────────────────────────────────────────
  onPlatform('invoices/[id]/issue', 'POST', (c) => ({
    ...ID(c.t.invoiceId),
    body: { facilityId: c.t.facilityId },
  })),
  onPlatform('invoices/[id]/pay', 'POST', (c) => ({
    ...ID(c.t.invoiceId),
    body: {
      facilityId: c.t.facilityId,
      paymentReference: 'FT-0001',
      amountKobo: 100,
      paidOn: today,
      payerName: 'Cross Tenant Probe',
    },
  })),
  onPlatform('invoices/[id]/void', 'POST', (c) => ({
    ...ID(c.t.invoiceId),
    body: { facilityId: c.t.facilityId, reason: 'Raised against the wrong hospital.' },
  })),
  onPlatform('payouts/[id]/release', 'POST', (c) => ({ ...ID(c.t.payoutId), body: {} })),
  onPlatform('payouts/[id]/settle', 'POST', (c) => ({
    ...ID(c.t.payoutId),
    body: { bankReference: 'FT-0001', paidOn: today },
  })),
  onPlatform('payouts/[id]/fail', 'POST', (c) => ({
    ...ID(c.t.payoutId),
    body: { reason: 'The bank returned the transfer.' },
  })),
  onPlatform('payouts/[id]/cancel', 'POST', (c) => ({
    ...ID(c.t.payoutId),
    body: { reason: 'Raised in error.' },
  })),
  // A practitioner's bank account, reviewed or read by the platform's finance team only.
  // No tenant owns one, so the practitioner's id stands in for an account's.
  onPlatform('payout-accounts/[id]/review', 'POST', (c) => ({
    ...ID(c.t.practitionerId),
    body: { decision: 'reject', note: 'Not a match.' },
  })),
  onPlatform('payout-accounts/practitioner/[id]', 'GET', (c) => ID(c.t.practitionerId)),

  // ── platform configuration, the register and operations ─────────────────
  // None of these records belongs to a hospital. They are here because they take
  // an identifier, and a hospital's people must be refused every one.
  onPlatform('cadre-levels/[id]/active', 'POST', (c) => ({ ...ID(c.t.facilityId), body: { active: false } })),
  onPlatform('registration-categories/[id]/active', 'POST', (c) => ({
    ...ID(c.t.facilityId),
    body: { active: false },
  })),
  onPlatform('holidays/[id]', 'DELETE', (c) => ID(c.t.facilityId)),
  onPlatform('sanctions/[id]/remove', 'POST', (c) => ({
    ...ID(c.t.facilityId),
    body: { reason: 'Listed in error.' },
  })),
  onPlatform('data-requests/[id]/erase', 'POST', (c) => ID(c.t.practitionerId)),
  onPlatform('admin/system/events/[id]/replay', 'POST', (c) => ID(c.t.facilityId)),

  // ── the suggestion box ───────────────────────────────────────────────────
  onPlatform('suggestions/[id]/triage', 'POST', (c) => ({
    ...ID(c.t.suggestionId),
    body: { status: 'TRIAGED', response: 'Thank you, we will look at it.' },
  })),
];

/**
 * Routes that name a scope in their input rather than in their path. An
 * attacker names the other tenant's scope (the guard must refuse), and then
 * names their own and must be shown only their own.
 */
interface ScopedCase {
  route: string;
  method: Method;
  role: Role;
  request: (c: Ctx) => Req;
  /** A listing: with the caller's own scope the answer must hold nothing of the other tenant. */
  listing?: boolean;
}

const SCOPED: ScopedCase[] = [
  {
    route: 'assignments',
    method: 'GET',
    role: 'owner',
    listing: true,
    request: (c) => ({ query: { scopeType: 'FACILITY', scopeId: c.declare } }),
  },
  {
    route: 'audit',
    method: 'GET',
    role: 'owner',
    request: (c) => ({ query: { scopeType: 'FACILITY', scopeId: c.declare } }),
  },
  {
    route: 'availability',
    method: 'GET',
    role: 'practitioner',
    request: (c) => ({ query: { scopeType: 'SELF', scopeId: c.t.practitionerId } }),
  },
  {
    route: 'credentials',
    method: 'GET',
    role: 'practitioner',
    request: (c) => ({ query: { scopeType: 'SELF', scopeId: c.t.practitionerId } }),
  },
  {
    route: 'dashboard/facility',
    method: 'GET',
    role: 'owner',
    listing: true,
    request: (c) => ({ query: { facilityId: c.declare } }),
  },
  {
    route: 'facilities',
    method: 'GET',
    role: 'owner',
    listing: true,
    request: (c) => ({ query: { scopeType: 'FACILITY', scopeId: c.declare } }),
  },
  {
    route: 'grants',
    method: 'GET',
    role: 'owner',
    listing: true,
    request: (c) => ({ query: { scopeType: 'FACILITY', scopeId: c.declare } }),
  },
  {
    route: 'grants/find',
    method: 'GET',
    role: 'owner',
    request: (c) => ({
      query: { scopeType: 'FACILITY', scopeId: c.declare, phone: c.t.practitionerPhone },
    }),
  },
  {
    route: 'incidents',
    method: 'GET',
    role: 'owner',
    listing: true,
    request: (c) => ({ query: { facilityId: c.declare } }),
  },
  {
    route: 'invoices',
    method: 'GET',
    role: 'owner',
    listing: true,
    request: (c) => ({ query: { facilityId: c.declare } }),
  },
  {
    route: 'rate-cards',
    method: 'GET',
    role: 'owner',
    listing: true,
    request: (c) => ({ query: { facilityId: c.declare } }),
  },
  {
    route: 'service-requests',
    method: 'GET',
    role: 'owner',
    listing: true,
    request: (c) => ({ query: { scopeType: 'FACILITY', scopeId: c.declare } }),
  },
  {
    route: 'practitioners/eligibility',
    method: 'GET',
    role: 'practitioner',
    request: (c) => ({ query: { scopeType: 'SELF', scopeId: c.t.practitionerId } }),
  },
  {
    route: 'practitioners/verification',
    method: 'GET',
    role: 'practitioner',
    request: (c) => ({ query: { scopeType: 'SELF', scopeId: c.t.practitionerId } }),
  },
  {
    route: 'agreements/facility',
    method: 'GET',
    role: 'owner',
    request: (c) => ({ query: { facilityId: c.declare } }),
  },
];

/** What must be refused when the caller names somebody else's facility in the body of a write. */
const SCOPED_WRITES: ScopedCase[] = [
  {
    route: 'grants',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: {
        userId: c.t.practitionerId,
        roleKey: 'facility_administrator',
        scopeType: 'FACILITY',
        scopeId: c.declare,
      },
    }),
  },
  {
    route: 'incidents',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: {
        facilityId: c.declare,
        subjectUserId: c.t.practitionerId,
        occurredAt: iso(-HOUR),
        severity: 'SEVERE',
        category: 'CONDUCT',
        summary: 'A baseless report about a practitioner we have never booked.',
      },
    }),
  },
  {
    route: 'invoices',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: { facilityId: c.declare, periodStart: iso(-30 * DAY), periodEnd: iso(-DAY) },
    }),
  },
  {
    route: 'rate-cards',
    method: 'POST',
    role: 'owner',
    request: (c) => ({ body: { facilityId: c.declare, name: 'Hijacked rate card' } }),
  },
  {
    route: 'suggestions',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: {
        area: 'OTHER',
        body: 'A suggestion filed in the name of somebody else’s hospital.',
        facilityId: c.declare,
      },
    }),
  },
  {
    route: 'service-requests',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: {
        facilityId: c.declare,
        professionalCategoryId: c.t.facilityId,
        shiftType: 'DAY',
        startsAt: iso(5 * DAY),
        endsAt: iso(5 * DAY + 8 * HOUR),
        headcount: 1,
        hourlyRateKobo: 500000,
        cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      },
    }),
  },
  {
    route: 'agreements/facility',
    method: 'POST',
    role: 'owner',
    request: (c) => ({ body: { facilityId: c.declare, versionId: c.t.disputeId } }),
  },
];

/**
 * Routes that take an identifier and are not in the tables above, with the
 * reason. Reviewed like any other change: "no identifier" is a claim.
 */
const NO_TENANT_IDENTIFIER: Record<string, string> = {
  'admin/performance': 'platform-only aggregate; takes no identifier',
  'admin/system': 'platform-only operations status; takes no identifier',
  agreements: "the caller's own acceptance, or the platform's publishing; takes no identifier",
  'agreements/versions': 'the platform’s own list; takes no identifier',
  'auth/login': 'before sign-in; no tenant data',
  'auth/logout': 'the caller’s own session',
  'auth/password/reset-confirm': 'before sign-in; no tenant data',
  'auth/password/reset-request': 'before sign-in; no tenant data',
  'auth/register': 'before sign-in; no tenant data',
  'auth/resend-code': 'before sign-in; no tenant data',
  'auth/session': 'the caller’s own session',
  'auth/set-password': 'before sign-in; no tenant data',
  'auth/step-up': 'the caller’s own session',
  'auth/verify-phone': 'before sign-in; no tenant data',
  'availability/blocks': 'creates for the caller; takes no identifier',
  'availability/slots': 'creates for the caller; takes no identifier',
  'cadre-levels': 'platform-only reference data; names a profession, which no hospital owns',
  consent: 'the caller’s own record; takes no identifier',
  'credentials/document-upload-url': 'for the caller’s own upload; takes no identifier',
  'dashboard/finance': 'platform-only aggregate; takes no identifier',
  'dashboard/platform': 'platform-only aggregate; takes no identifier',
  'dashboard/practitioner': 'the caller’s own figures, read from the session; takes no identifier',
  'data-requests': 'the caller’s own request, or the platform’s queue; takes no identifier',
  disputes: 'the platform’s queue; takes no identifier',
  'facilities/register': 'creates for the caller; takes no identifier',
  'finance/invoices': 'the platform’s list; takes no identifier',
  health: 'public',
  'health/background': 'operations probe; no tenant data',
  holidays: 'platform-only calendar; takes no identifier',
  'incidents/queue': 'the platform’s queue; takes no identifier',
  invitations: 'the caller’s own invitations, read from the session',
  'me/data-requests': 'the caller’s own record, read from the session',
  'me/erasure': 'the caller’s own record, read from the session',
  'me/export': 'the caller’s own record, read from the session',
  'me/notifications': 'the caller’s own inbox, read from the session',
  'me/notifications/read':
    'the caller’s own inbox: the ids in the body are matched against the session’s own messages, which inbox.test.ts attacks',
  'me/payout-account': 'the caller’s own account, read from the session',
  'payout-accounts': 'the platform’s review queue; takes no identifier',
  'practitioners/me': 'the caller’s own profile, read from the session',
  'practitioners/me/photo-upload-url': 'the caller’s own photograph; takes no identifier',
  'practitioners/me/photo-url': 'the caller’s own photograph; takes no identifier',
  'practitioners/me/submit': 'the caller’s own application; takes no identifier',
  practitioners: 'the platform’s directory; takes no identifier',
  'rate-floors': 'platform-only pay floors by profession and level; no hospital owns one',
  reference: 'public reference data',
  'registration-categories': 'platform-only reference data; names a profession, which no hospital owns',
  sanctions: 'the platform’s register of listed people; takes no tenant identifier',
  'suggestions/summary': 'the platform’s aggregate; takes no identifier',
  unhonoured: 'the platform’s queue; takes no identifier',
};

/** Platform-scoped routes that take an identifier in the body or query: refused for any hospital. */
const PLATFORM_ROUTES: ScopedCase[] = [
  {
    route: 'facilities',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: {
        name: 'Hijacked Hospital',
        facilityTypeId: c.t.facilityId,
        cacNumber: 'RC999999',
        stateId: c.t.facilityId,
        addressLine: '1 Nowhere Road',
        contactPhone: '08031234567',
        representativeUserId: c.t.ownerId,
      },
    }),
  },
  {
    route: 'payouts',
    method: 'POST',
    role: 'owner',
    request: (c) => ({ body: { practitionerId: c.t.practitionerId } }),
  },
  {
    route: 'payouts',
    method: 'GET',
    role: 'owner',
    request: (c) => ({ query: { scopeType: 'PLATFORM', scopeId: c.t.practitionerId } }),
  },
  {
    route: 'users/find',
    method: 'GET',
    role: 'owner',
    request: (c) => ({ query: { phone: c.t.practitionerPhone } }),
  },
  { route: 'suggestions', method: 'GET', role: 'owner', request: () => ({ query: {} }) },
  {
    route: 'practitioners/verification/confirm',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: { kind: 'identity', submissionId: c.t.credentialId, nameMatch: true },
    }),
  },
  {
    route: 'practitioners/verification/identity',
    method: 'POST',
    role: 'owner',
    request: (c) => ({ body: { userId: c.t.practitionerId, nin: '12345678901', nameMatch: true } }),
  },
  {
    route: 'practitioners/verification/registration',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: {
        userId: c.t.practitionerId,
        regulator: 'MDCN',
        folioNumber: 'MDCN/1/1',
        registrationStatus: 'ACTIVE',
      },
    }),
  },
  {
    route: 'practitioners/verification/standing',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: { userId: c.t.practitionerId, cadreLevelId: null, registrationCategoryId: null },
    }),
  },
  {
    route: 'practitioners/screening',
    method: 'POST',
    role: 'owner',
    request: (c) => ({
      body: {
        userId: c.t.practitionerId,
        notes: 'Cleared as a false positive after checking the identity document.',
      },
    }),
  },
  {
    route: 'practitioners/screening',
    method: 'GET',
    role: 'owner',
    request: (c) => ({ query: { userId: c.t.practitionerId } }),
  },
];

/**
 * A document somebody else uploaded, submitted as one's own. The route takes
 * the object's key, the key is not a secret in the way a password is, and what
 * stops the caller reading a stranger's licence by "submitting" it is the
 * check that the stored object is theirs. Nothing tested it before this.
 */
const STOLEN_DOCUMENTS: {
  route: string;
  method: Method;
  request: (own: Tenant, theirs: Tenant) => Req;
}[] = [
  {
    route: 'credentials',
    method: 'POST',
    request: (own, theirs) => ({
      body: { credentialTypeId: own.docTypeId, documentObjectKey: theirs.documentKey },
    }),
  },
  {
    route: 'credentials/[id]',
    method: 'PATCH',
    request: (own, theirs) => ({
      params: { id: own.queriedCredentialId },
      body: { documentObjectKey: theirs.documentKey },
    }),
  },
];

// ── running a case ──────────────────────────────────────────────────────────

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const routeModules = import.meta.glob<Record<string, RouteHandler>>('/src/app/api/v1/**/route.ts');

function routeKey(path: string): string {
  return path.replace('/src/app/api/v1/', '').replace(/\/route\.ts$/, '');
}

const ROUTE_LOADERS = new Map(
  Object.entries(routeModules).map(([path, loader]) => [routeKey(path), loader]),
);

async function call(route: string, method: Method, userId: string, req: Req) {
  clearCookies();
  await issueSession({ userId, stepUp: true });

  let path = route;
  for (const [name, value] of Object.entries(req.params ?? {}))
    path = path.replace(`[${name}]`, value);
  const query = req.query ? `?${new URLSearchParams(req.query)}` : '';

  const loader = ROUTE_LOADERS.get(route);
  if (!loader) throw new Error(`No route file for "${route}".`);
  const handler = (await loader())[method];
  if (!handler) throw new Error(`"${route}" does not export ${method}.`);

  const response = await handler(
    new Request(`http://localhost/api/v1/${path}${query}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
    }),
    { params: Promise.resolve(req.params ?? {}) },
  );
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, text, body };
}

function errorCode(body: unknown): string {
  return (body as { error?: { code?: string } } | null)?.error?.code ?? '';
}

function userFor(t: Tenant, role: Role | 'invitee'): string {
  if (role === 'owner') return t.ownerId;
  if (role === 'invitee') return t.inviteeId;
  return t.practitionerId;
}

/** Everything of the other tenant that must not appear in an answer to this one. */
function markers(t: Tenant): string[] {
  const ids = Object.values(t).filter(
    (value): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value),
  );
  return [...ids, t.label, t.practitionerPhone];
}

function leaks(text: string, t: Tenant): string[] {
  return markers(t).filter((marker) => text.includes(marker));
}

// ── the fingerprint ─────────────────────────────────────────────────────────

/**
 * What changes when somebody signs in, and so says nothing about a route.
 * A session and its audit row are written by every call this file makes.
 */
const NOT_STATE = /\.(sessions|audit_log|security_events|login_attempts|otp_codes|devices)$/;

let tableNames: string[] | null = null;

async function fingerprint(): Promise<Map<string, string>> {
  if (!tableNames) {
    const rows = await prisma.$queryRaw<{ qualified: string }[]>`
      SELECT format('%I.%I', schemaname, tablename) AS qualified
        FROM pg_tables
       WHERE schemaname IN (${Prisma.join([...MUTABLE_SCHEMAS])})
    `;
    tableNames = rows
      .map((row) => row.qualified)
      .filter((name) => !NOT_STATE.test(name.replace(/"/g, '')));
  }

  // One round trip for every table: a hash of all its rows, with the one column
  // that changes on sign-in left out.
  const statement = tableNames
    .map((table) => {
      // Signing in touches the user's last_login_at and, with it, updated_at.
      const row =
        table === 'identity.users'
          ? "(to_jsonb(x) - 'last_login_at' - 'updated_at')::text"
          : 'to_jsonb(x)::text';
      return `SELECT '${table}' AS t, md5(COALESCE(string_agg(${row}, '|' ORDER BY ${row}), '')) AS h FROM ${table} x`;
    })
    .join(' UNION ALL ');
  const rows = await prisma.$queryRawUnsafe<{ t: string; h: string }[]>(statement);
  return new Map(rows.map((row) => [row.t, row.h]));
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after].filter(([table, hash]) => before.get(table) !== hash).map(([table]) => table);
}

// ── the tests ───────────────────────────────────────────────────────────────

const REFUSED = [403, 404];

beforeEach(() => {
  clearCookies();
});

describe('the table', () => {
  it('names every route that takes an identifier, or says why it does not', async () => {
    const inTable = new Set<string>([
      ...CASES.map((c) => `${c.route} ${c.method}`),
      ...SCOPED.map((c) => `${c.route} ${c.method}`),
      ...SCOPED_WRITES.map((c) => `${c.route} ${c.method}`),
      ...PLATFORM_ROUTES.map((c) => `${c.route} ${c.method}`),
      ...STOLEN_DOCUMENTS.map((c) => `${c.route} ${c.method}`),
    ]);
    const inTableRoutes = new Set([...inTable].map((entry) => entry.split(' ')[0]));

    const unaccounted: string[] = [];
    for (const [route, loader] of ROUTE_LOADERS) {
      const exported = Object.keys(await loader()).filter((name) =>
        ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(name),
      );
      const dynamic = route.includes('[');
      for (const method of exported) {
        if (inTable.has(`${route} ${method}`)) continue;
        // A static route is excused only if the whole route is: a table entry for
        // one method of it does not speak for the others.
        if (!dynamic && NO_TENANT_IDENTIFIER[route] && !inTableRoutes.has(route)) continue;
        unaccounted.push(`${method} /api/v1/${route}`);
      }
    }

    expect(
      unaccounted,
      'These routes are not in tests/integration/cross-tenant.test.ts. Add a case that attacks each from another tenant, or, if it takes no identifier, add it to NO_TENANT_IDENTIFIER with the reason.',
    ).toEqual([]);
  }, 180_000);

  it('does not excuse a route that does not exist', () => {
    const stale = Object.keys(NO_TENANT_IDENTIFIER).filter((route) => !ROUTE_LOADERS.has(route));
    expect(stale).toEqual([]);
  });
});

describe('a caller from one hospital, and everything of another’s they can name', () => {
  it('is refused every one, and changes and reveals nothing', async () => {
    const world: TenantWorld = await buildTenantWorld();
    const { a, b } = world;
    const failures: string[] = [];

    async function attack(
      label: string,
      route: string,
      method: Method,
      role: Role,
      req: Req,
      target: Tenant,
    ) {
      const before = await fingerprint();
      const result = await call(route, method, userFor(a, role), req);
      const after = await fingerprint();

      if (!REFUSED.includes(result.status)) {
        failures.push(
          `${label}: answered ${result.status} ${errorCode(result.body)} instead of 403/404`,
        );
      }
      const touched = changed(before, after);
      if (touched.length > 0) failures.push(`${label}: changed ${touched.join(', ')}`);
      const exposed = leaks(result.text, target);
      if (exposed.length > 0)
        failures.push(`${label}: the answer contained ${exposed.slice(0, 3).join(', ')}`);
    }

    for (const c of CASES) {
      for (const role of c.attackers) {
        const variants =
          c.declares && role === 'owner'
            ? (['their facility', 'own facility'] as const)
            : (['-'] as const);
        for (const variant of variants) {
          const declare = variant === 'own facility' ? a.facilityId : b.facilityId;
          const req = c.request({ role, t: b, declare });
          await attack(
            `${c.method} ${c.route} as ${role} A${variant === '-' ? '' : `, naming ${variant}`}`,
            c.route,
            c.method,
            role,
            req,
            b,
          );
        }
      }
    }

    for (const c of [...SCOPED, ...SCOPED_WRITES, ...PLATFORM_ROUTES]) {
      // Naming the other tenant's scope, or the other tenant's person.
      await attack(
        `${c.method} ${c.route} as ${c.role} A, naming their scope`,
        c.route,
        c.method,
        c.role,
        c.request({ role: c.role, t: b, declare: b.facilityId }),
        b,
      );
    }

    // Somebody else's uploaded file, offered as one's own. Refused as an invalid
    // reference - the same answer as a file that was never uploaded, so the
    // key is not confirmed to exist.
    for (const attack of STOLEN_DOCUMENTS) {
      const before = await fingerprint();
      const result = await call(
        attack.route,
        attack.method,
        a.practitionerId,
        attack.request(a, b),
      );
      const after = await fingerprint();
      const label = `${attack.method} ${attack.route} as practitioner A, with B's document`;
      if (result.status !== 422 || errorCode(result.body) !== 'invalid_document_reference') {
        failures.push(
          `${label}: answered ${result.status} ${errorCode(result.body)} instead of 422 invalid_document_reference`,
        );
      }
      const touched = changed(before, after);
      if (touched.length > 0) failures.push(`${label}: changed ${touched.join(', ')}`);
    }

    expect(failures).toEqual([]);
  }, 600_000);

  it('is shown only its own when it names its own scope', async () => {
    const { a, b } = await buildTenantWorld();
    const failures: string[] = [];

    for (const c of SCOPED.filter((entry) => entry.listing)) {
      const result = await call(
        c.route,
        c.method,
        userFor(a, c.role),
        c.request({ role: c.role, t: a, declare: a.facilityId }),
      );
      if (result.status !== 200) {
        failures.push(
          `${c.method} ${c.route}: answered ${result.status} ${errorCode(result.body)} for its own scope`,
        );
        continue;
      }
      const exposed = leaks(result.text, b);
      if (exposed.length > 0)
        failures.push(`${c.method} ${c.route}: contained ${exposed.slice(0, 3).join(', ')}`);
    }

    expect(failures).toEqual([]);
  }, 300_000);
});

describe('the controls', () => {
  it('let the rightful caller through everything the attacks were refused', async () => {
    const world = await buildTenantWorld();
    const { b } = world;
    const failures: string[] = [];

    for (const c of CASES) {
      const callers: { who: string; userId: string; role: Role }[] =
        c.control === 'admin'
          ? [{ who: 'the platform', userId: world.platformAdminId, role: 'owner' }]
          : c.control === 'invitee'
            ? [{ who: 'the invitee', userId: b.inviteeId, role: 'practitioner' }]
            : (c.controlRoles ?? c.attackers).map((role) => ({
                who: `${role} B`,
                userId: userFor(b, role),
                role,
              }));

      for (const caller of callers) {
        const req = c.request({ role: caller.role, t: b, declare: b.facilityId });
        const result = await call(c.route, c.method, caller.userId, req);

        // A platform route's record may have no business being decided (an
        // invoice already issued, a facility already verified): what the
        // control shows is that it is not refused for who is asking.
        const refused = c.lenientControl
          ? result.status === 401 || result.status === 403
          : [401, 403, 404].includes(result.status);
        // 404 from a platform caller is a missing record; from anybody else it is the bug.
        if (refused) {
          failures.push(
            `${c.method} ${c.route} as ${caller.who}: answered ${result.status} ${errorCode(result.body)}`,
          );
        } else if (result.status === 422 && errorCode(result.body) === 'validation_failed') {
          failures.push(
            `${c.method} ${c.route} as ${caller.who}: the request itself is malformed (${JSON.stringify((result.body as { error?: { details?: unknown } }).error?.details ?? '').slice(0, 160)})`,
          );
        }
      }
    }

    // The same two requests, for the person whose document it is.
    for (const attack of STOLEN_DOCUMENTS) {
      const result = await call(
        attack.route,
        attack.method,
        b.practitionerId,
        attack.request(b, b),
      );
      if (
        [401, 403, 404].includes(result.status) ||
        errorCode(result.body) === 'invalid_document_reference'
      ) {
        failures.push(
          `${attack.method} ${attack.route} as practitioner B, with their own document: answered ${result.status} ${errorCode(result.body)}`,
        );
      }
    }

    expect(failures).toEqual([]);
  }, 600_000);
});
