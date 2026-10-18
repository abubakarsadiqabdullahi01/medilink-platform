import { prisma } from '@/lib/db';
import { withdrawnFromMatching } from '@/modules/audit-compliance/application/consent';
import { getEligibility } from './eligibility';
import {
  credentialNeeds,
  type CredentialNeed,
  type ExtraReason,
  type NotOfferedView,
} from '../domain/not-offered';

/**
 * Everything that stands between one practitioner and being offered a shift, for them to read
 * (M02-07): the eligibility rule's blockers exactly as `getEligibility` gives them, which
 * documents are outstanding and where each stands, and the two things that keep an approved
 * practitioner from being offered work although the rule is satisfied.
 *
 * `getEligibility` is what matching and every booking step call, so it is left as it is. This adds
 * to what is *shown*, and cannot change who is matched.
 */
export async function getNotOfferedView(userId: string, now: Date = new Date()): Promise<NotOfferedView> {
  const base = await getEligibility(userId, now);

  const profile = await prisma.practitionerProfile.findUnique({
    where: { userId },
    select: { professionalCategoryId: true },
  });

  const [required, submissions, withdrawn, usableSlots] = await Promise.all([
    profile
      ? prisma.credentialRequirement.findMany({
          where: { professionalCategoryId: profile.professionalCategoryId, isMandatory: true },
          select: { credentialType: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
    prisma.credentialSubmission.findMany({
      where: { userId, deletedAt: null },
      select: { credentialTypeId: true, status: true, createdAt: true, reviewNotes: true },
    }),
    withdrawnFromMatching([userId]),
    // A weekly pattern that has not ended, or a one-off that has not finished. A slot in the past is
    // not something a shift can be matched against, so it does not count as having said when.
    prisma.availabilitySlot.count({
      where: {
        userId,
        deletedAt: null,
        OR: [
          { kind: 'RECURRING_WEEKLY', OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
          { kind: 'ONE_OFF', endsAt: { gt: now } },
        ],
      },
    }),
  ]);

  const credentials: CredentialNeed[] = credentialNeeds({
    required: required
      .map((row) => row.credentialType)
      .sort((a, b) => a.name.localeCompare(b.name)),
    submissions,
  });

  const alsoStopsOffers: ExtraReason[] = [];
  if (withdrawn.has(userId)) alsoStopsOffers.push('consent_withdrawn');
  if (usableSlots === 0) alsoStopsOffers.push('no_availability');

  return { ...base, credentials, alsoStopsOffers };
}
