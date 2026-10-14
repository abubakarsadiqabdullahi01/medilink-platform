import { describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  invitePractitioners,
  listInvitationsFor,
  respondToInvitation,
} from '@/modules/matching/application/assignment';
import { buildBookingWorld, eligiblePractitioner, type BookingWorld } from './support/booking-world';

/**
 * What a practitioner sees before they say yes, and what is kept of it.
 *
 * The offer showed the rate and the times and hid the cancellation terms, the
 * ward and what to bring, the address and the headcount; they accepted blind,
 * and nothing recorded what they had been shown. In a dispute about a late
 * cancellation, neither side could say what had been agreed.
 */

const NOTES = 'Ward 3, report to the nurse in charge. Bring your own stethoscope and ID badge.';

async function offered(world: BookingWorld) {
  await prisma.serviceRequest.update({ where: { id: world.requestId }, data: { notes: NOTES } });
  const nurse = await eligiblePractitioner(world);
  const [invitation] = await invitePractitioners({
    requestId: world.requestId,
    facilityId: world.facilityId,
    userIds: [nurse.id],
    actorId: world.schedulerId,
  });
  return { nurse, invitation: invitation! };
}

describe('the offer a practitioner reads', () => {
  it('shows the terms, the notes, the address and the headcount, not only the rate and the times', async () => {
    const world = await buildBookingWorld({ headcount: 3 });
    const { nurse } = await offered(world);

    const [offer] = await listInvitationsFor(nurse.id);

    expect(offer).toMatchObject({
      facilityName: 'Owerri General Hospital',
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      notes: NOTES,
      addressLine: '14 Wetheral Road, Owerri',
      headcount: 3,
      hourlyRateKobo: 500_000,
    });
  });

  it('has no notes to show when the facility wrote none', async () => {
    const world = await buildBookingWorld();
    const nurse = await eligiblePractitioner(world);
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [nurse.id],
      actorId: world.schedulerId,
    });

    const [offer] = await listInvitationsFor(nurse.id);
    expect(offer!.notes).toBeNull();
  });
});

describe('accepting', () => {
  it('keeps what the practitioner was shown, as it stood when they said yes', async () => {
    const world = await buildBookingWorld();
    const { nurse, invitation } = await offered(world);

    await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' });

    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.termsAccepted).toMatchObject({
      cancellationTerms: 'Either party may cancel up to 24 hours before the shift.',
      notes: NOTES,
      hourlyRateKobo: 500_000,
      facilityName: 'Owerri General Hospital',
      addressLine: '14 Wetheral Road, Owerri',
    });
    expect(row.termsAccepted).toHaveProperty('acceptedAt');
    expect(row.termsAccepted).toHaveProperty('startsAt');
    expect(row.termsAccepted).toHaveProperty('endsAt');
  });

  it('keeps it even if the request is changed afterwards', async () => {
    const world = await buildBookingWorld();
    const { nurse, invitation } = await offered(world);
    await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' });

    // Whatever happens to the request, what was agreed is what was shown.
    await prisma.serviceRequest.update({
      where: { id: world.requestId },
      data: { cancellationTerms: 'No cancellation permitted at any time.' },
    });

    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(JSON.stringify(row.termsAccepted)).toContain('up to 24 hours before');
    expect(JSON.stringify(row.termsAccepted)).not.toContain('No cancellation permitted');
  });

  it('records nothing for a decline', async () => {
    const world = await buildBookingWorld();
    const { nurse, invitation } = await offered(world);

    await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'decline', reason: 'Not available that day.' });

    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).termsAccepted).toBeNull();
  });

  it('records a fresh acceptance when an offer is made again and accepted again', async () => {
    const world = await buildBookingWorld();
    const { nurse, invitation } = await offered(world);
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
    await invitePractitioners({
      requestId: world.requestId,
      facilityId: world.facilityId,
      userIds: [nurse.id],
      actorId: world.schedulerId,
    });

    // Reopened: the acceptance of the earlier offer must not stand for this one.
    const reopened = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(reopened.termsAccepted).toBeNull();

    await respondToInvitation({ invitationId: invitation.id, userId: nurse.id, decision: 'accept' });
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } })).termsAccepted).not.toBeNull();
  });
});
