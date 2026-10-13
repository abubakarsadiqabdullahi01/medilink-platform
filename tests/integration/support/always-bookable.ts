/**
 * Stands in for the booking-time eligibility check in suites that are about
 * something else.
 *
 * Inviting, accepting and confirming now ask whether the practitioner is still
 * eligible, in the profession and consenting — which, for a real practitioner,
 * means a profile, a verified identity, a registration, screening and a
 * credential. A suite about attendance, timesheets or billing has no use for
 * all that and would drown its own setup in it, so it replaces the check:
 *
 *   vi.mock('@/modules/practitioners/application/bookable', () => import('./support/always-bookable'));
 *
 * The check itself is exercised for real in `booking-revalidation.test.ts`.
 */
export async function bookingBlockersFor(userIds: string[]) {
  return new Map<string, never[]>(userIds.map((userId) => [userId, []]));
}

export async function bookingBlockers() {
  return [] as never[];
}
