import { prisma } from '@/lib/db';
import { withdrawnFromMatching } from '@/modules/audit-compliance/application/consent';
import { standingsFor } from './candidates';
import { getEligibilityFor } from './eligibility';

/**
 * Why somebody cannot be offered, accept, or be confirmed onto a shift *now*.
 *
 * Matching decides who to rank at the moment it runs. An invitation, an
 * acceptance and a confirmation each happen later — hours or days — and the
 * world moves in between: a licence lapses, an account is suspended, somebody
 * withdraws consent to be shown to facilities. Every step that creates or
 * advances a booking asks this again, so what was true at match time never
 * stands in for what is true at booking time.
 *
 * Built from the same pieces matching uses (`getEligibilityFor`, the consent
 * check) so it cannot disagree with matching about who is eligible.
 */
export type BookingBlocker =
  | 'not_eligible'
  | 'wrong_profession'
  | 'wrong_level'
  | 'supervision_required'
  | 'consent_withdrawn';

/** What a booking is for: the profession, and the level and supervision it asks for (REQ-01). */
export interface BookingTarget {
  professionalCategoryId: string;
  // Required, not optional: a caller that forgot to carry them would skip the check
  // without a word, which is how the first version of this missed the acceptance step.
  cadreLevelId: string | null;
  supervisionAvailable: boolean;
}

export async function bookingBlockersFor(
  userIds: string[],
  target: BookingTarget,
  now: Date = new Date(),
): Promise<Map<string, BookingBlocker[]>> {
  const ids = [...new Set(userIds)];
  const professionalCategoryId = target.professionalCategoryId;
  const [eligibility, profiles, withdrawn, standings] = await Promise.all([
    getEligibilityFor(ids, now),
    prisma.practitionerProfile.findMany({
      where: { userId: { in: ids }, deletedAt: null },
      select: { userId: true, professionalCategoryId: true },
    }),
    withdrawnFromMatching(ids),
    standingsFor(ids),
  ]);
  const categoryOf = new Map(profiles.map((profile) => [profile.userId, profile.professionalCategoryId]));

  const result = new Map<string, BookingBlocker[]>();
  for (const userId of ids) {
    const blockers: BookingBlocker[] = [];
    if (!(eligibility.get(userId)?.eligible ?? false)) blockers.push('not_eligible');
    if (categoryOf.get(userId) !== professionalCategoryId) blockers.push('wrong_profession');
    // The same two rules matching applies, asked again at booking time because the
    // register is looked at again in between: a level changed after the offer stops
    // the booking.
    const standing = standings.get(userId);
    if (target.cadreLevelId && standing?.cadreLevelId !== target.cadreLevelId) blockers.push('wrong_level');
    if (standing?.supervised && !target.supervisionAvailable) blockers.push('supervision_required');
    if (withdrawn.has(userId)) blockers.push('consent_withdrawn');
    result.set(userId, blockers);
  }
  return result;
}

export async function bookingBlockers(
  userId: string,
  target: BookingTarget,
  now: Date = new Date(),
): Promise<BookingBlocker[]> {
  return (await bookingBlockersFor([userId], target, now)).get(userId) ?? ['not_eligible'];
}
