import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const { cookieJar } = await import('./support/cookie-jar');
  return { cookies: () => cookieJar };
});

import { prisma } from '@/lib/db';
import { ROLE_PERMISSIONS } from '@/lib/authz/permissions';
import { addSlot } from '@/modules/availability/application/availability';
import { availabilityForWindow } from '@/modules/availability/application/availability';
import { recordConsent } from '@/modules/audit-compliance/application/consent';
import { createProfile } from '@/modules/practitioners/application/profile';
import { bookingBlockers } from '@/modules/practitioners/application/bookable';
import { getEligibility } from '@/modules/practitioners/application/eligibility';
import { getNotOfferedView } from '@/modules/practitioners/application/not-offered';
import { headline, reasonLines } from '@/modules/practitioners/domain/not-offered';
import { issueSession } from '@/modules/auth/application/session-service';
import { GET as eligibilityRoute } from '@/app/api/v1/practitioners/eligibility/route';
import { GET as overviewRoute } from '@/app/api/v1/dashboard/practitioner/route';
import { clearCookies } from './support/cookie-jar';
import { buildBookingWorld, eligiblePractitioner, lapseRegistration, type BookingWorld } from './support/booking-world';
import {
  createCredentialRequirement,
  createCredentialType,
  createProfessionalCategory,
  createState,
  createUser,
  grant,
} from './support/fixtures';

/**
 * M02-07: what a practitioner is told about why they are not being offered shifts has to be what
 * actually stops them.
 *
 * Each explanation here is tied to the rule that does the stopping: the view says a document is
 * outstanding only when the eligibility rule does, says consent is withdrawn only when matching
 * and every booking step leave them out for it, and says there is no availability only when the
 * matcher cannot find them free for any shift. A sentence on a screen that the engine disagrees
 * with is worse than none.
 */

beforeEach(() => {
  clearCookies();
});

const SOON = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

/** What the matcher says about a practitioner for the shift the world published. */
async function availabilityVerdict(userId: string, world: BookingWorld) {
  return (await availabilityForWindow(userId, { startsAt: world.startsAt, endsAt: world.endsAt })).reason;
}

describe('an approved practitioner', () => {
  it('has nothing in the way when everything is in place, including a time they are free', async () => {
    const world = await buildBookingWorld();
    const person = await eligiblePractitioner(world);
    await addSlot({ userId: person.id, kind: 'ONE_OFF', startsAt: world.startsAt, endsAt: world.endsAt });

    const view = await getNotOfferedView(person.id);

    expect(view).toEqual({ eligible: true, blockers: [], credentials: [], alsoStopsOffers: [] });
    expect(headline(view)).toBe('offered');
    expect(reasonLines(view)).toEqual([]);
    // And matching agrees: free for the shift, bookable for it.
    expect(await availabilityVerdict(person.id, world)).toBe('available');
    expect(
      await bookingBlockers(person.id, { professionalCategoryId: world.categoryId, cadreLevelId: null, supervisionAvailable: false }),
    ).toEqual([]);
  });

  describe('who has never said when they can work', () => {
    it('is approved and still not offered, and the page says so', async () => {
      const world = await buildBookingWorld();
      const person = await eligiblePractitioner(world);

      const view = await getNotOfferedView(person.id);

      expect(view.eligible).toBe(true);
      expect(view.alsoStopsOffers).toEqual(['no_availability']);
      expect(headline(view)).toBe('approved_but_not_offered');
      // The matcher cannot find them free for the shift either.
      expect(await availabilityVerdict(person.id, world)).not.toBe('available');
      // The rule itself is untouched: matching still thinks them eligible.
      expect((await getEligibility(person.id)).eligible).toBe(true);
    });

    it('is cleared by a time they are free', async () => {
      const world = await buildBookingWorld();
      const person = await eligiblePractitioner(world);
      await addSlot({ userId: person.id, kind: 'ONE_OFF', startsAt: world.startsAt, endsAt: world.endsAt });

      expect((await getNotOfferedView(person.id)).alsoStopsOffers).toEqual([]);
    });

    it('is cleared by a weekly pattern with no end, or one that ends later', async () => {
      const world = await buildBookingWorld();
      const open = await eligiblePractitioner(world);
      const ending = await eligiblePractitioner(world);
      await addSlot({ userId: open.id, kind: 'RECURRING_WEEKLY', dayOfWeek: 1, startMinute: 480, endMinute: 960 });
      await addSlot({
        userId: ending.id,
        kind: 'RECURRING_WEEKLY',
        dayOfWeek: 1,
        startMinute: 480,
        endMinute: 960,
        effectiveUntil: SOON(30),
      });

      expect((await getNotOfferedView(open.id)).alsoStopsOffers).toEqual([]);
      expect((await getNotOfferedView(ending.id)).alsoStopsOffers).toEqual([]);
    });

    it('is not cleared by a pattern that has ended, nor a one-off that has passed, nor one they deleted', async () => {
      const world = await buildBookingWorld();
      const person = await eligiblePractitioner(world);
      await prisma.availabilitySlot.createMany({
        data: [
          { userId: person.id, kind: 'RECURRING_WEEKLY', dayOfWeek: 1, startMinute: 480, endMinute: 960, effectiveUntil: SOON(-3) },
          { userId: person.id, kind: 'ONE_OFF', startsAt: SOON(-10), endsAt: new Date(SOON(-10).getTime() + 8 * 3_600_000) },
          { userId: person.id, kind: 'ONE_OFF', startsAt: world.startsAt, endsAt: world.endsAt, deletedAt: new Date() },
        ],
      });

      expect((await getNotOfferedView(person.id)).alsoStopsOffers).toEqual(['no_availability']);
      expect(await availabilityVerdict(person.id, world)).not.toBe('available');
    });

    it('is not told they have said nothing when they have said when, only not for this shift', async () => {
      const world = await buildBookingWorld();
      const person = await eligiblePractitioner(world);
      // Free next month, not on the day of the shift: they have said when, and the matcher leaves
      // them out of this shift for it. That is a fact about the shift, not about their account.
      await addSlot({ userId: person.id, kind: 'ONE_OFF', startsAt: SOON(40), endsAt: new Date(SOON(40).getTime() + 8 * 3_600_000) });

      expect((await getNotOfferedView(person.id)).alsoStopsOffers).toEqual([]);
      expect(await availabilityVerdict(person.id, world)).not.toBe('available');
    });
  });

  describe('who has turned off being shown to facilities', () => {
    const target = (world: BookingWorld) => ({
      professionalCategoryId: world.categoryId,
      cadreLevelId: null,
      supervisionAvailable: false,
    });

    it.each(['PROFILE_VISIBILITY', 'CREDENTIAL_SHARING'] as const)('is told, when %s is withdrawn, and matching leaves them out for it', async (purpose) => {
      const world = await buildBookingWorld();
      const person = await eligiblePractitioner(world);
      await addSlot({ userId: person.id, kind: 'ONE_OFF', startsAt: world.startsAt, endsAt: world.endsAt });
      await recordConsent({ userId: person.id, purpose, granted: false, note: 'I would rather facilities did not see this.', actorId: person.id });

      const view = await getNotOfferedView(person.id);

      expect(view.alsoStopsOffers).toEqual(['consent_withdrawn']);
      expect(headline(view)).toBe('approved_but_not_offered');
      expect(await bookingBlockers(person.id, target(world))).toContain('consent_withdrawn');
    });

    it('is cleared when they agree again, since the latest answer is the one that counts', async () => {
      const world = await buildBookingWorld();
      const person = await eligiblePractitioner(world);
      await addSlot({ userId: person.id, kind: 'ONE_OFF', startsAt: world.startsAt, endsAt: world.endsAt });
      await recordConsent({ userId: person.id, purpose: 'PROFILE_VISIBILITY', granted: false, note: 'I would rather facilities did not see this.', actorId: person.id });
      await recordConsent({ userId: person.id, purpose: 'PROFILE_VISIBILITY', granted: true, actorId: person.id });

      expect((await getNotOfferedView(person.id)).alsoStopsOffers).toEqual([]);
      expect(await bookingBlockers(person.id, target(world))).not.toContain('consent_withdrawn');
    });

    it('is not told off for withdrawing something that does not affect matching', async () => {
      const world = await buildBookingWorld();
      const person = await eligiblePractitioner(world);
      await addSlot({ userId: person.id, kind: 'ONE_OFF', startsAt: world.startsAt, endsAt: world.endsAt });
      await recordConsent({ userId: person.id, purpose: 'MARKETING', granted: false, note: 'I would rather facilities did not see this.', actorId: person.id });

      expect((await getNotOfferedView(person.id)).alsoStopsOffers).toEqual([]);
    });

    it('lists both reasons, in a fixed order, when both are true', async () => {
      const world = await buildBookingWorld();
      const person = await eligiblePractitioner(world);
      await recordConsent({ userId: person.id, purpose: 'PROFILE_VISIBILITY', granted: false, note: 'I would rather facilities did not see this.', actorId: person.id });

      expect((await getNotOfferedView(person.id)).alsoStopsOffers).toEqual(['consent_withdrawn', 'no_availability']);
    });
  });

  it('keeps the rule’s blockers exactly as matching reads them, whatever else is added', async () => {
    const world = await buildBookingWorld();
    const person = await eligiblePractitioner(world);
    await lapseRegistration(person.id);

    const view = await getNotOfferedView(person.id);

    expect(view.blockers).toEqual((await getEligibility(person.id)).blockers);
    expect(view.blockers).toContain('registration_not_active');
    expect(view.eligible).toBe(false);
    expect(headline(view)).toBe('not_eligible');
  });
});

describe('a practitioner’s required documents', () => {
  /** A profession that requires two documents, and somebody in it with nothing sent. */
  async function twoDocuments() {
    const category = await createProfessionalCategory({ regulator: 'MDCN' });
    const licence = await createCredentialType({ name: 'Practising licence' });
    const slip = await createCredentialType({ name: 'National identity number slip' });
    await createCredentialRequirement({ professionalCategoryId: category.id, credentialTypeId: licence.id });
    await createCredentialRequirement({ professionalCategoryId: category.id, credentialTypeId: slip.id });
    const state = await createState();
    const person = await createUser({ fullName: 'Amina Yusuf' });
    await createProfile({
      userId: person.id,
      professionalCategoryId: category.id,
      yearsOfExperience: 4,
      homeStateId: state.id,
    });
    return { person, licence, slip };
  }

  const send = (userId: string, credentialTypeId: string, status: 'PENDING' | 'MORE_INFO_REQUESTED' | 'REJECTED' | 'VERIFIED' | 'EXPIRED', extra: { reviewNotes?: string; createdAt?: Date } = {}) =>
    prisma.credentialSubmission.create({
      data: { userId, credentialTypeId, status, referenceNumber: 'REF-1', ...extra },
    });

  it('names each document and says none has been sent', async () => {
    const { person } = await twoDocuments();

    const view = await getNotOfferedView(person.id);

    expect(view.credentials!.map((need) => [need.name, need.state])).toEqual([
      ['National identity number slip', 'not_submitted'],
      ['Practising licence', 'not_submitted'],
    ]);
    expect(view.blockers).toContain('credential_missing');
  });

  it('says a document that has been sent is waiting, and puts it on Medilink’s side', async () => {
    const { person, licence } = await twoDocuments();
    await send(person.id, licence.id, 'PENDING');

    const view = await getNotOfferedView(person.id);
    const lines = reasonLines(view).filter((line) => line.text.includes('Practising licence'));

    expect(view.credentials!.find((need) => need.name === 'Practising licence')!.state).toBe('waiting');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ owner: 'medilink' });
    expect(lines[0]!.text).not.toMatch(/not submitted/i);
  });

  it('carries what the officer wrote when a document was sent back or refused', async () => {
    const { person, licence, slip } = await twoDocuments();
    await send(person.id, licence.id, 'MORE_INFO_REQUESTED', { reviewNotes: 'The photograph is not clear enough to read.' });
    await send(person.id, slip.id, 'REJECTED', { reviewNotes: 'This is not your slip.' });

    const lines = reasonLines(await getNotOfferedView(person.id));

    const licenceLine = lines.find((line) => line.text.includes('Practising licence'))!;
    const slipLine = lines.find((line) => line.text.includes('National identity number slip'))!;
    expect(licenceLine.text).toContain('The photograph is not clear enough to read.');
    expect(licenceLine.owner).toBe('you');
    expect(slipLine.text).toContain('This is not your slip.');
    expect(slipLine).toMatchObject({ owner: 'you', action: 'Send a new one' });
  });

  it('stops listing a document once it is verified, and the rule agrees', async () => {
    const { person, licence, slip } = await twoDocuments();
    await send(person.id, licence.id, 'VERIFIED');
    expect((await getNotOfferedView(person.id)).credentials!.map((need) => need.name)).toEqual(['National identity number slip']);

    await send(person.id, slip.id, 'VERIFIED');
    const view = await getNotOfferedView(person.id);

    expect(view.credentials).toEqual([]);
    expect(view.blockers).not.toContain('credential_missing');
    expect(view.blockers).not.toContain('credential_expired');
  });

  it('says a licence that has expired has expired, and the rule reports it', async () => {
    const { person, licence } = await twoDocuments();
    await send(person.id, licence.id, 'EXPIRED');

    const view = await getNotOfferedView(person.id);

    expect(view.credentials!.find((need) => need.name === 'Practising licence')!.state).toBe('expired');
    expect(view.blockers).toContain('credential_expired');
  });

  it('goes by the latest answer, so a replacement waiting replaces the refusal it follows', async () => {
    const { person, licence } = await twoDocuments();
    await send(person.id, licence.id, 'REJECTED', { reviewNotes: 'Blurred.', createdAt: new Date(Date.now() - 5 * 86_400_000) });
    await send(person.id, licence.id, 'PENDING', { createdAt: new Date(Date.now() - 1 * 86_400_000) });

    const need = (await getNotOfferedView(person.id)).credentials!.find((row) => row.name === 'Practising licence')!;

    expect(need).toMatchObject({ state: 'waiting', note: null });
  });

  it('ignores a document the person deleted, and one the profession does not require', async () => {
    const { person, licence } = await twoDocuments();
    const unrelated = await createCredentialType({ name: 'Parking permit' });
    await send(person.id, licence.id, 'VERIFIED', {});
    await prisma.credentialSubmission.updateMany({ where: { userId: person.id, credentialTypeId: licence.id }, data: { deletedAt: new Date() } });
    await send(person.id, unrelated.id, 'VERIFIED');

    const states = Object.fromEntries((await getNotOfferedView(person.id)).credentials!.map((need) => [need.name, need.state]));

    expect(states['Practising licence']).toBe('not_submitted');
    expect(states).not.toHaveProperty('Parking permit');
  });

  it('does not list a document the profession only recommends, and the rule does not either', async () => {
    const { person, licence, slip } = await twoDocuments();
    const profile = await prisma.practitionerProfile.findUniqueOrThrow({ where: { userId: person.id } });
    const optional = await createCredentialType({ name: 'Hepatitis B vaccination record' });
    await createCredentialRequirement({
      professionalCategoryId: profile.professionalCategoryId,
      credentialTypeId: optional.id,
      isMandatory: false,
    });
    await send(person.id, licence.id, 'VERIFIED');
    await send(person.id, slip.id, 'VERIFIED');

    const view = await getNotOfferedView(person.id);

    expect(view.credentials).toEqual([]);
    expect(view.blockers).not.toContain('credential_missing');
  });

  it('lists nothing, rather than failing, for somebody with no profile yet', async () => {
    const person = await createUser({ fullName: 'Newcomer' });

    const view = await getNotOfferedView(person.id);

    expect(view.credentials).toEqual([]);
    expect(view.blockers).toContain('profile_incomplete');
    expect(view.alsoStopsOffers).toContain('no_availability');
  });
});

describe('through the routes', () => {
  async function signedIn(userId: string) {
    clearCookies();
    await grant({
      userId,
      roleKey: 'practitioner_self_test',
      permissions: ['practitioner.profile.read', 'availability.read', 'credential.document.read', 'service_request.read'],
      scopeType: 'SELF',
      scopeId: userId,
    });
    await issueSession({ userId });
  }

  it('sends the practitioner the same view, from the eligibility route', async () => {
    const world = await buildBookingWorld();
    const person = await eligiblePractitioner(world);
    await recordConsent({ userId: person.id, purpose: 'PROFILE_VISIBILITY', granted: false, note: 'I would rather facilities did not see this.', actorId: person.id });
    await signedIn(person.id);

    const response = await eligibilityRoute(
      new Request(`http://localhost/api/v1/practitioners/eligibility?scopeType=SELF`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(await getNotOfferedView(person.id))));
  });

  it('seeds the overview with the same view, so the home page and the profile agree', async () => {
    const world = await buildBookingWorld();
    const person = await eligiblePractitioner(world);
    await signedIn(person.id);

    const response = await overviewRoute(new Request('http://localhost/api/v1/dashboard/practitioner'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.eligibility).toMatchObject({ eligible: true, alsoStopsOffers: ['no_availability'], credentials: [] });
  });

  it('lets compliance read another practitioner’s, and nobody read a stranger’s as their own', async () => {
    const world = await buildBookingWorld();
    const person = await eligiblePractitioner(world);
    const stranger = await createUser({ fullName: 'Somebody Else' });
    const officer = await createUser({ fullName: 'Officer' });
    await grant({
      userId: officer.id,
      roleKey: 'administrator',
      permissions: ROLE_PERMISSIONS.administrator ?? [],
      scopeType: 'PLATFORM',
    });
    await issueSession({ userId: officer.id });

    const asOfficer = await eligibilityRoute(
      new Request(`http://localhost/api/v1/practitioners/eligibility?scopeType=PLATFORM&scopeId=${person.id}`),
    );
    expect(asOfficer.status).toBe(200);
    expect((await asOfficer.json()).eligible).toBe(true);

    await signedIn(stranger.id);
    const asStranger = await eligibilityRoute(
      new Request(`http://localhost/api/v1/practitioners/eligibility?scopeType=SELF&scopeId=${person.id}`),
    );
    expect(asStranger.status).toBe(403);
  });
});
