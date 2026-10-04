import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { createFacility, verifyFacility } from '@/modules/facilities/application/facility';
import {
  createServiceRequest,
  publishServiceRequest,
} from '@/modules/service-requests/application/request';
import {
  invitePractitioners,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import {
  getSuggestion,
  listSuggestions,
  submitSuggestion,
  suggestionsByArea,
  triageSuggestion,
} from '@/modules/suggestions/application/suggestion';
import { ROUTES } from '@/modules/suggestions/routes';
import { clearCookies } from './support/cookie-jar';
import {
  createFacilityType,
  createProfessionalCategory,
  createState,
  createUser,
  ensureRole,
  grant,
} from './support/fixtures';

/**
 * Module 18, step 9.5 — the pilot's suggestion log.
 *
 * The assertion that matters is the derived one: `docs/stage-6-5-6-6-6-7-
 * assignments.md` has said since Stage 6 that "the pilot's suggestion log is
 * built from exactly this", meaning decline reasons. Until now that was a
 * sentence in a document.
 */

let sequence = 0;

beforeEach(() => {
  clearCookies();
});

describe('somebody filing one', () => {
  it('records it against them, under an area', async () => {
    const user = await createUser();

    const suggestion = await submitSuggestion({
      userId: user.id,
      area: 'MATCHING',
      body: 'I am never offered night shifts even though that is all I set myself available for.',
    });

    expect(suggestion.source).toBe('USER');
    expect(suggestion.raisedBy).toBe(user.id);
    expect(suggestion.status).toBe('NEW');
    expect(suggestion.response).toBeNull();
  });

  it('refuses an empty one', async () => {
    const user = await createUser();
    await expect(
      submitSuggestion({ userId: user.id, area: 'OTHER', body: '  ' }),
    ).rejects.toMatchObject({ code: 'suggestion_cannot_submit' });
  });

  it('writes an audit row', async () => {
    const user = await createUser();
    const suggestion = await submitSuggestion({
      userId: user.id,
      area: 'PAYMENTS',
      body: 'The invoice does not say which shift it is for.',
    });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'suggestion.submitted', entityId: suggestion.id },
    });
    expect(audit?.actorId).toBe(user.id);
  });
});

describe('a decline reason becoming one', () => {
  const DECLINE = 'The rate is below what I can accept for a night shift this far from home.';

  async function invitedPractitioner() {
    await ensureRole('facility_owner', ROLE_PERMISSIONS.facility_owner ?? []);
    const state = await createState();
    const facilityType = await createFacilityType();
    const representative = await createUser({ fullName: 'Facility Representative' });
    const ops = await createUser({ fullName: 'Operations Officer' });
    const verifier = await createUser({ fullName: 'Verifying Officer' });

    sequence += 1;
    const facility = await createFacility({
      name: 'Abuja Central Clinic',
      facilityTypeId: facilityType.id,
      cacNumber: `RC${800_000 + sequence}`,
      stateId: state.id,
      addressLine: '5 Aminu Kano Crescent, Abuja',
      contactPhone: '+2348031234567',
      representativeUserId: representative.id,
      actorId: ops.id,
    });
    await verifyFacility({ facilityId: facility.id, verifierId: verifier.id, decision: 'approve' });

    const category = await createProfessionalCategory();
    const scheduler = await createUser({ fullName: 'Facility Scheduler' });
    await grant({
      userId: scheduler.id,
      roleKey: 'facility_scheduler',
      permissions: ['service_request.publish', 'assignment.confirm'],
      scopeType: 'FACILITY',
      scopeId: facility.id,
    });

    const startsAt = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const request = await createServiceRequest({
      facilityId: facility.id,
      professionalCategoryId: category.id,
      shiftType: 'NIGHT',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 8 * 60 * 60 * 1000),
      headcount: 1,
      hourlyRateKobo: 500_000,
      urgency: 'ROUTINE',
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      actorId: scheduler.id,
    });
    await publishServiceRequest({
      requestId: request.id,
      facilityId: facility.id,
      actorId: scheduler.id,
    });

    const practitioner = await createUser({ fullName: 'Declining Practitioner' });
    const [invitation] = await invitePractitioners({
      requestId: request.id,
      facilityId: facility.id,
      userIds: [practitioner.id],
      actorId: scheduler.id,
    });

    return { invitationId: invitation!.id, practitionerId: practitioner.id };
  }

  it('lands in the log when an invitation is declined', async () => {
    const { invitationId, practitionerId } = await invitedPractitioner();

    await respondToInvitation({
      invitationId,
      userId: practitionerId,
      decision: 'decline',
      reason: DECLINE,
    });

    const derived = await prisma.suggestion.findFirst({ where: { sourceRef: invitationId } });
    expect(derived?.source).toBe('DECLINE_REASON');
    expect(derived?.body).toBe(DECLINE);
    // Always MATCHING: a decline is by construction about what was offered
    // and how. Guessing a finer area from free text would be inventing data.
    expect(derived?.area).toBe('MATCHING');
  });

  it('does not put the practitioner s name on it', async () => {
    const { invitationId, practitionerId } = await invitedPractitioner();
    await respondToInvitation({
      invitationId,
      userId: practitionerId,
      decision: 'decline',
      reason: DECLINE,
    });

    // They were answering an invitation, not filing a suggestion. Attributing
    // it would put words in their mouth, and would put a candid decline
    // reason under their name in an operations queue.
    const derived = await prisma.suggestion.findFirstOrThrow({
      where: { sourceRef: invitationId },
    });
    expect(derived.raisedBy).toBeNull();

    // The invitation id is still there, so the two can be joined by somebody
    // who needs to.
    expect(derived.sourceRef).toBe(invitationId);
  });

  it('writes nothing when an invitation is accepted', async () => {
    const { invitationId, practitionerId } = await invitedPractitioner();
    await respondToInvitation({ invitationId, userId: practitionerId, decision: 'accept' });

    expect(await prisma.suggestion.findFirst({ where: { sourceRef: invitationId } })).toBeNull();
  });
});

describe('triaging', () => {
  async function filed(area: 'MATCHING' | 'PAYMENTS' = 'MATCHING') {
    const user = await createUser();
    return submitSuggestion({
      userId: user.id,
      area,
      body: 'I am never offered night shifts even though that is all I set myself available for.',
    });
  }

  it('moves along the queue without a response', async () => {
    const suggestion = await filed();

    const triaged = await triageSuggestion({
      suggestionId: suggestion.id,
      actorId: (await createUser()).id,
      status: 'PLANNED',
    });

    expect(triaged.status).toBe('PLANNED');
    expect(triaged.triagedAt).not.toBeNull();
  });

  it('refuses to close one without an answer', async () => {
    const suggestion = await filed();
    const officer = await createUser();

    for (const status of ['DONE', 'DECLINED'] as const) {
      await expect(
        triageSuggestion({ suggestionId: suggestion.id, actorId: officer.id, status }),
      ).rejects.toMatchObject({ code: 'suggestion_cannot_triage' });
    }

    expect((await getSuggestion(suggestion.id)).status).toBe('NEW');
  });

  it('closes one with an answer, and keeps it', async () => {
    const suggestion = await filed();
    const officer = await createUser();

    const declined = await triageSuggestion({
      suggestionId: suggestion.id,
      actorId: officer.id,
      status: 'DECLINED',
      response: 'Night-only availability is honoured; the shifts offered were the only ones open.',
    });

    expect(declined.status).toBe('DECLINED');
    expect(declined.response).toContain('the only ones open');
    expect(declined.triagedBy).toBe(officer.id);

    // Nothing is deleted from a log whose value is that it records what
    // people actually asked for.
    expect((await listSuggestions()).suggestions.map((row) => row.id)).toContain(suggestion.id);
  });

  it('will not reopen a closed one', async () => {
    const suggestion = await filed();
    const officer = await createUser();
    await triageSuggestion({
      suggestionId: suggestion.id,
      actorId: officer.id,
      status: 'DONE',
      response: 'Shipped in the September release.',
    });

    await expect(
      triageSuggestion({ suggestionId: suggestion.id, actorId: officer.id, status: 'PLANNED' }),
    ).rejects.toMatchObject({ code: 'suggestion_cannot_triage' });
  });

  it('narrows the log by status and by area', async () => {
    const matching = await filed('MATCHING');
    const payments = await filed('PAYMENTS');

    const byArea = await listSuggestions({ area: 'PAYMENTS' });
    expect(byArea.suggestions.map((row) => row.id)).toContain(payments.id);
    expect(byArea.suggestions.map((row) => row.id)).not.toContain(matching.id);

    const byStatus = await listSuggestions({ status: 'NEW' });
    expect(byStatus.suggestions.map((row) => row.id)).toContain(matching.id);
  });

  it('pages the log rather than returning all of it', async () => {
    for (let index = 0; index < 3; index += 1) await filed();

    const first = await listSuggestions({ limit: 2 });
    expect(first.suggestions).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listSuggestions({ limit: 2, cursor: first.nextCursor! });
    expect(second.suggestions).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    // The two pages together are the three rows filed above, once each.
    const ids = [...first.suggestions, ...second.suggestions].map((row) => row.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('the summary', () => {
  it('counts by area, with the open ones separated', async () => {
    const user = await createUser();
    const officer = await createUser();

    const first = await submitSuggestion({
      userId: user.id,
      area: 'TIMESHEETS',
      body: 'The break field is not obvious and I keep leaving it at nought.',
    });
    await submitSuggestion({
      userId: user.id,
      area: 'TIMESHEETS',
      body: 'I cannot see what the facility changed when they corrected my hours.',
    });
    await triageSuggestion({
      suggestionId: first.id,
      actorId: officer.id,
      status: 'DONE',
      response: 'Break field relabelled and defaulted from the shift pattern.',
    });

    // What a founder deciding what to fix next needs is the shape of the
    // complaints, not the complaints themselves.
    const areas = await suggestionsByArea();
    const timesheets = areas.find((row) => row.area === 'TIMESHEETS');
    expect(timesheets?.total).toBe(2);
    expect(timesheets?.open).toBe(1);
  });
});

describe('the route table', () => {
  it('submits at SELF and triages at PLATFORM', () => {
    const submit = ROUTES.find((route) => route.permission === 'suggestion.submit');
    expect(submit?.scopeType).toBe('SELF');
    for (const route of ROUTES.filter((r) => r.permission === 'suggestion.triage')) {
      expect(route.scopeType).toBe('PLATFORM');
    }
  });

  it('gives a facility no way to read the log', () => {
    // A facility reading every practitioner's complaints about it is not what
    // anybody agreed to.
    expect(ROUTES.some((route) => route.scopeType === 'FACILITY')).toBe(false);
  });
});
