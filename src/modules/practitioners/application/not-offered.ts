import { prisma } from '@/lib/db';
import { withdrawnFromMatching } from '@/modules/audit-compliance/application/consent';
import { availabilitySummary } from '@/modules/availability/application/availability';
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
 * documents are outstanding and where each stands, and what else keeps an approved practitioner
 * from being offered work although the rule is satisfied: they turned off being shown, they have
 * said nothing about when they can work, or everything they offered lies in time they are away.
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

  const [required, submissions, withdrawn, availability] = await Promise.all([
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
    // Read from the model the matcher uses, so what a practitioner is told is what matching does:
    // whether anything they entered is still in play, and whether any of it survives their time away.
    availabilitySummary(userId, now),
  ]);

  const credentials: CredentialNeed[] = credentialNeeds({
    required: required
      .map((row) => row.credentialType)
      .sort((a, b) => a.name.localeCompare(b.name)),
    submissions,
  });

  const alsoStopsOffers: ExtraReason[] = [];
  if (withdrawn.has(userId)) alsoStopsOffers.push('consent_withdrawn');
  if (!availability.hasUsableSlots) alsoStopsOffers.push('no_availability');
  else if (!availability.next) alsoStopsOffers.push('time_away');

  return { ...base, credentials, alsoStopsOffers };
}
