'use client';

import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/ui/api';
import { useScopeIds } from '@/lib/ui/session';

export interface FacilitySummary {
  id: string;
  name: string;
  status: string;
  /** Compliance's note on a rejection, which the owner is owed. */
  reviewNotes?: string | null;
}

/**
 * The facility this console is acting for.
 *
 * Read off the caller's own grants rather than picked from a list: a
 * scheduler should never have to know their hospital's uuid.
 *
 * Somebody with grants at two facilities gets both ids back, and chooses
 * between them with the switcher at the top of the console; `useFacilityId`
 * answers with that choice.
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

/**
 * Which facility a person with several has chosen to act for.
 *
 * Kept in this browser rather than on the server: it is a view preference,
 * like a remembered tab, and two people sharing an account on two ward
 * computers each mean a different hospital. Storage can throw — a private
 * window, blocked site data — and the console must still work, so every read
 * and write is guarded and the fallback is simply the first facility.
 */
const CHOICE_KEY = 'medilink.facility';
const listeners = new Set<() => void>();
/** What was chosen in this page, for when storage refused to keep it. */
let memory: string | null = null;

function readChoice(): string | null {
  try {
    return window.localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab choosing a different facility moves this one too, rather
  // than leaving two tabs quietly acting for two hospitals.
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function chooseFacility(facilityId: string): void {
  try {
    window.localStorage.setItem(CHOICE_KEY, facilityId);
  } catch {
    // Not remembered past this page, which is the most a blocked store allows.
  }
  memory = facilityId;
  listeners.forEach((listener) => listener());
}

/**
 * The facility this console is acting for: the one chosen, if the account
 * still holds a grant there, and otherwise the first — which is the only one
 * for almost everybody.
 */
export function useFacilityId(): string | null {
  const ids = useFacilityIds();
  const chosen = useSyncExternalStore(
    subscribe,
    () => readChoice() ?? memory,
    () => null,
  );
  return chosen && ids.includes(chosen) ? chosen : (ids[0] ?? null);
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
