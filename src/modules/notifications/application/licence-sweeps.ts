import { prisma } from '@/lib/db';
import { usersHoldingFacilityPermission } from '@/modules/auth/application/grants';
import { notify, requireDelivered, type NotifyOutcome } from './notify';
import { alreadyNotified } from './handlers';

/**
 * A facility's licence about to lapse, and one that has (M04-03).
 *
 * A lapsed licence already stops a facility publishing a shift, inviting somebody or confirming
 * them (`publishBlockers`), with no job involved. What nobody did was say so before it happened:
 * a hospital found out when its next shift would not publish. This tells the people who run the
 * facility a month ahead and again in the last week, and once when it has lapsed.
 *
 * Run daily, and idempotent: a person is told once at each stage *for that expiry date*, and one
 * who could not be reached is tried again by the next run because only a message that went counts.
 *
 * The stages and the period a lapse is announced for are starting points to be tuned against how
 * facilities behave, not measurements. A facility whose licence lapsed longer ago than that is not
 * announced to: it already knows, and the first run after this ships should not text every
 * long-lapsed facility at once.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Warned this long before the licence expires, and again in the last week. */
export const LICENCE_WARNING_DAYS = [30, 7] as const;

/** A lapse is announced for this long after it happens, and not after. */
export const LICENCE_LAPSE_ANNOUNCED_DAYS = 14;

/**
 * Only a message sent within this long before the expiry date counts as having told them
 * about *this* expiry: last year's warning for last year's licence must not silence this year's.
 */
const SAME_EXPIRY_WINDOW_DAYS = 45;

const lagosDate = (date: Date) => new Date(date.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Everyone who runs the facility: its representative, and whoever holds `facility.write` there
 * (the people who can upload the renewed licence). Once each.
 */
async function peopleWhoRun(facility: { id: string; representativeUserId: string }): Promise<string[]> {
  const writers = await usersHoldingFacilityPermission(facility.id, 'facility.write');
  return [...new Set([facility.representativeUserId, ...writers.map((user) => user.id)])];
}

export async function warnExpiringFacilityLicences(now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + LICENCE_WARNING_DAYS[0] * DAY);
  const expiring = await prisma.facility.findMany({
    where: { status: 'VERIFIED', deletedAt: null, licenceExpiresAt: { gt: now, lte: horizon } },
    select: { id: true, name: true, licenceExpiresAt: true, representativeUserId: true },
  });

  const outcomes: NotifyOutcome[] = [];
  for (const facility of expiring) {
    const expiresAt = facility.licenceExpiresAt!;
    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / DAY);
    const kind =
      daysLeft <= LICENCE_WARNING_DAYS[1] ? 'facility.licence_expiry_warning_7' : 'facility.licence_expiry_warning_30';
    const since = new Date(expiresAt.getTime() - SAME_EXPIRY_WINDOW_DAYS * DAY);

    for (const userId of await peopleWhoRun(facility)) {
      if (await alreadyNotified(userId, kind, facility.id, since)) continue;
      outcomes.push(
        await notify({
          userId,
          kind,
          // Renewing sends a verified facility back for review straight away, so the advice is to do it
          // early enough for the check, not on the last day.
          body: `The licence on file for ${facility.name} expires on ${lagosDate(expiresAt)} (in ${daysLeft} day${daysLeft === 1 ? '' : 's'}). After that it cannot publish shifts or confirm practitioners. Upload the renewed licence in Medilink now: Medilink checks it before it counts. Medilink.`,
          relatedType: 'facilities.facilities',
          relatedId: facility.id,
        }),
      );
    }
  }

  requireDelivered(outcomes);
  return outcomes.filter((outcome) => outcome.sent).length;
}

export async function announceLapsedFacilityLicences(now: Date = new Date()): Promise<number> {
  const lapsed = await prisma.facility.findMany({
    where: {
      status: 'VERIFIED',
      deletedAt: null,
      licenceExpiresAt: { lte: now, gt: new Date(now.getTime() - LICENCE_LAPSE_ANNOUNCED_DAYS * DAY) },
    },
    select: { id: true, name: true, licenceExpiresAt: true, representativeUserId: true },
  });

  const outcomes: NotifyOutcome[] = [];
  for (const facility of lapsed) {
    const expiresAt = facility.licenceExpiresAt!;
    const since = new Date(expiresAt.getTime() - SAME_EXPIRY_WINDOW_DAYS * DAY);

    for (const userId of await peopleWhoRun(facility)) {
      if (await alreadyNotified(userId, 'facility.licence_expired', facility.id, since)) continue;
      outcomes.push(
        await notify({
          userId,
          kind: 'facility.licence_expired',
          body: `The licence on file for ${facility.name} expired on ${lagosDate(expiresAt)}. It cannot publish shifts or confirm practitioners until a renewed licence is uploaded in Medilink and checked. Medilink.`,
          relatedType: 'facilities.facilities',
          relatedId: facility.id,
        }),
      );
    }
  }

  requireDelivered(outcomes);
  return outcomes.filter((outcome) => outcome.sent).length;
}
