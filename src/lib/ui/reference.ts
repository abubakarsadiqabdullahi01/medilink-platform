'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/ui/api';

export interface ReferenceData {
  professionalCategories: { id: string; name: string; regulator: string }[];
  specialties: { id: string; name: string; categoryId: string }[];
  credentialTypes: {
    id: string;
    name: string;
    key: string;
    verificationMethod: string;
    requiredForCategoryIds: string[];
  }[];
  facilityTypes: { id: string; name: string }[];
  states: { id: string; name: string; zone: string }[];
  lgas: { id: string; name: string; stateId: string }[];
  verification: { identityAutomated: boolean; registrationAutomated: boolean };
}

/**
 * The controlled vocabularies, cached for the session.
 *
 * They change when compliance edits them, which is roughly never, so an hour
 * of staleness costs nothing and refetching them on every form open would be
 * six queries per page for a list of Nigerian states.
 */
export function useReference() {
  return useQuery({
    queryKey: ['reference'],
    queryFn: () => api.get<ReferenceData>('/api/v1/reference'),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

/** Turns an id into the name a person recognises. */
export function nameOf(
  list: { id: string; name: string }[] | undefined,
  id: string | null | undefined,
): string {
  if (!id) return '—';
  return list?.find((row) => row.id === id)?.name ?? id.slice(0, 8);
}
