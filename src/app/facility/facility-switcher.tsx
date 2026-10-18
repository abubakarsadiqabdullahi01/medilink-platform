'use client';

import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { api } from '@/lib/ui/api';
import {
  chooseFacility,
  useFacilityId,
  useFacilityIds,
  type FacilitySummary,
} from '@/lib/ui/facility';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Which hospital the console is acting for, for somebody who works at more
 * than one.
 *
 * Shown only then. Everybody else has exactly one facility and a control
 * offering a choice of one is noise.
 *
 * Switching resets every cached answer but the session. Most queries carry
 * the facility id in their key and would refetch anyway; the ones that do not
 * would otherwise go on showing the last hospital's roster under this one's
 * name, which is the one mistake this control must never make.
 */
export function FacilitySwitcher() {
  const ids = useFacilityIds();
  const current = useFacilityId();
  const queryClient = useQueryClient();

  const names = useQueries({
    queries: ids.map((id) => ({
      // The same key useFacility reads, so a name fetched here is the one
      // every heading shows.
      queryKey: ['facility', id],
      queryFn: () => api.get<FacilitySummary>(`/api/v1/facilities/${id}`),
      staleTime: 5 * 60 * 1000,
    })),
  });

  if (ids.length < 2 || !current) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
      <label
        id="facility-switcher-label"
        htmlFor="facility-switcher"
        className="text-sm text-muted-foreground"
      >
        Acting for
      </label>
      <Select
        value={current}
        onValueChange={(next) => {
          if (next === current) return;
          chooseFacility(next);
          void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
        }}
      >
        <SelectTrigger
          id="facility-switcher"
          className="h-8 w-auto min-w-[14rem]"
          aria-labelledby="facility-switcher-label"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ids.map((id, index) => (
            <SelectItem key={id} value={id}>
              {names[index]?.data?.name ?? 'Loading…'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
