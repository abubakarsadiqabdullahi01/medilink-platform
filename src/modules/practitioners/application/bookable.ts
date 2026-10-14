import { prisma, type Tx } from '@/lib/db';
import { withdrawnFromMatching } from '@/modules/audit-compliance/application/consent';
import { getEligibilityFor, type EligibilityReader } from './eligibility';

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
export type BookingBlocker = 'not_eligible' | 'wrong_profession' | 'consent_withdrawn';

type BookingReader = EligibilityReader & Pick<Tx, 'practitionerProfile' | 'consentRecord'>;

export async function bookingBlockersFor(
  userIds: string[],
  professionalCategoryId: string,
  now: Date = new Date(),
  db: BookingReader = prisma,
): Promise<Map<string, BookingBlocker[]>> {
  const ids = [...new Set(userIds)];
  const [eligibility, profiles, withdrawn] = await Promise.all([
    getEligibilityFor(ids, now, db),
    db.practitionerProfile.findMany({
      where: { userId: { in: ids }, deletedAt: null },
      select: { userId: true, professionalCategoryId: true },
    }),
    withdrawnFromMatching(ids, db),
  ]);
  const categoryOf = new Map(
    profiles.map((profile) => [profile.userId, profile.professionalCategoryId]),
  );

  const result = new Map<string, BookingBlocker[]>();
  for (const userId of ids) {
    const blockers: BookingBlocker[] = [];
    if (!(eligibility.get(userId)?.eligible ?? false)) blockers.push('not_eligible');
    if (categoryOf.get(userId) !== professionalCategoryId) blockers.push('wrong_profession');
    if (withdrawn.has(userId)) blockers.push('consent_withdrawn');
    result.set(userId, blockers);
  }
  return result;
}

export async function bookingBlockers(
  userId: string,
  professionalCategoryId: string,
  now: Date = new Date(),
  db: BookingReader = prisma,
): Promise<BookingBlocker[]> {
  return (
    (await bookingBlockersFor([userId], professionalCategoryId, now, db)).get(userId) ?? [
      'not_eligible',
    ]
  );
}
