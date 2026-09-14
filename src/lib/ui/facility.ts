'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/ui/api';
import { useScopeIds } from '@/lib/ui/session';

export interface FacilitySummary {
  id: string;
  name: string;
  status: string;
}

/**
 * The facility this console is acting for.
 *
 * Read off the caller's own grants rather than picked from a list: a
 * scheduler should never have to know their hospital's uuid, and one who
 * holds grants at two gets both back so a page can offer the choice.
 *
 * The union across permissions matters — a ward manager may hold
 * `timesheet.approve` at a facility without holding `service_request.read`
 * there, and would otherwise see an empty console on the page that does not
 * name their permission.
 */
export function useFacilityIds(): string[] {
  const read = useScopeIds('service_request.read', 'FACILITY');
  const publish = useScopeIds('service_request.publish', 'FACILITY');
  const approve = useScopeIds('timesheet.approve', 'FACILITY');
  const attendance = useScopeIds('attendance.record', 'FACILITY');
  const incident = useScopeIds('incident.report', 'FACILITY');

  return [...new Set([...read, ...publish, ...approve, ...attendance, ...incident])];
}

/** The first one, which is the only one for almost everybody. */
export function useFacilityId(): string | null {
  return useFacilityIds()[0] ?? null;
}

/** Its name, so headings say "Owerri General" rather than a uuid. */
export function useFacility(facilityId: string | null) {
  return useQuery({
    queryKey: ['facility', facilityId],
    queryFn: () => api.get<FacilitySummary>(`/api/v1/facilities/${facilityId}`),
    enabled: Boolean(facilityId),
    staleTime: 5 * 60 * 1000,
  });
}
