import { prisma } from '@/lib/db';

/**
 * The controlled vocabularies every form in the product needs.
 *
 * Read by practitioners filling a profile, facilities publishing a shift and
 * operations onboarding a hospital — which is to say by everybody. Before
 * this there was no way to populate a category dropdown from the API at all,
 * so the only clients that could work were ones that already knew the ids.
 */

export interface ReferenceData {
  professionalCategories: { id: string; name: string }[];
  specialties: { id: string; name: string; categoryId: string }[];
  credentialTypes: { id: string; name: string }[];
  facilityTypes: { id: string; name: string }[];
  states: { id: string; name: string }[];
  lgas: { id: string; name: string; stateId: string }[];
}

export async function getReferenceData(): Promise<ReferenceData> {
  const [professionalCategories, specialties, credentialTypes, facilityTypes, states, lgas] =
    await Promise.all([
      prisma.professionalCategory.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.specialty.findMany({
        select: { id: true, name: true, categoryId: true },
        orderBy: { name: 'asc' },
      }),
      prisma.credentialType.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.facilityType.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.state.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.lga.findMany({
        select: { id: true, name: true, stateId: true },
        orderBy: { name: 'asc' },
      }),
    ]);

  return { professionalCategories, specialties, credentialTypes, facilityTypes, states, lgas };
}
