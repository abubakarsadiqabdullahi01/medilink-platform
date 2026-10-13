import { prisma } from '@/lib/db';
import {
  isAutomatedIdentityVerificationEnabled,
  isAutomatedRegistrationVerificationEnabled,
} from '@/lib/verification';

/**
 * The controlled vocabularies every form in the product needs.
 *
 * Read by practitioners filling a profile, facilities publishing a shift and
 * operations onboarding a hospital — which is to say by everybody. Before
 * this there was no way to populate a category dropdown from the API at all,
 * so the only clients that could work were ones that already knew the ids.
 */

export interface ReferenceData {
  professionalCategories: { id: string; name: string; regulator: string }[];
  specialties: { id: string; name: string; categoryId: string }[];
  /**
   * `key` and `verificationMethod` are here because a client cannot otherwise
   * tell which credentials need a document attached and which take a
   * reference number — and submitting the wrong one is refused with a 422
   * the form could have prevented.
   */
  credentialTypes: {
    id: string;
    name: string;
    key: string;
    verificationMethod: string;
    /** Professions that must have this verified before they can be offered work. */
    requiredForCategoryIds: string[];
  }[];
  facilityTypes: { id: string; name: string }[];
  /** `zone` is one of the six geopolitical zones — shown under the state
   *  name in the picker, and searchable, so "south east" narrows the list. */
  states: { id: string; name: string; zone: string }[];
  lgas: { id: string; name: string; stateId: string }[];
  /**
   * Whether a provider checks a NIN or a licence automatically. While one does
   * not (the default — neither subscription exists), an officer checks by
   * reading a photograph of the slip or licence, so the form has to ask for
   * one: a number alone would leave them nothing to read.
   */
  verification: { identityAutomated: boolean; registrationAutomated: boolean };
}

export async function getReferenceData(): Promise<ReferenceData> {
  const [professionalCategories, specialties, rawCredentialTypes, requirements, facilityTypes, states, lgas] =
    await Promise.all([
      prisma.professionalCategory.findMany({
        select: { id: true, name: true, regulator: true },
        orderBy: { name: 'asc' },
      }),
      prisma.specialty.findMany({
        select: { id: true, name: true, categoryId: true },
        orderBy: { name: 'asc' },
      }),
      prisma.credentialType.findMany({
        select: { id: true, name: true, key: true, verificationMethod: true },
        orderBy: { name: 'asc' },
      }),
      prisma.credentialRequirement.findMany({
        where: { isMandatory: true },
        select: { credentialTypeId: true, professionalCategoryId: true },
      }),
      prisma.facilityType.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.state.findMany({
        select: { id: true, name: true, zone: true },
        orderBy: { name: 'asc' },
      }),
      prisma.lga.findMany({
        select: { id: true, name: true, stateId: true },
        orderBy: { name: 'asc' },
      }),
    ]);

  // Said here so a practitioner can be told which documents are theirs to
  // submit, rather than being shown every type the platform knows about.
  const credentialTypes = rawCredentialTypes.map((type) => ({
    ...type,
    requiredForCategoryIds: requirements
      .filter((row) => row.credentialTypeId === type.id)
      .map((row) => row.professionalCategoryId),
  }));

  return {
    professionalCategories,
    specialties,
    credentialTypes,
    facilityTypes,
    states,
    lgas,
    verification: {
      identityAutomated: isAutomatedIdentityVerificationEnabled(),
      registrationAutomated: isAutomatedRegistrationVerificationEnabled(),
    },
  };
}
