'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/ui/api';
import type { DescribedEstimate } from '@/modules/rates-contracts/domain/estimate';
import { MAX_HEADCOUNT } from '@/modules/service-requests/domain/request';

/** A value that follows `value` once it has stopped changing for `ms`, so typing a rate asks once. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export interface ShiftEstimateInput {
  facilityId: string | null | undefined;
  startsAt: Date | null;
  endsAt: Date | null;
  hourlyRateKobo: number;
  headcount: number;
  /** For a caller that may not ask: somebody who cannot publish for the facility would be refused. */
  allowed?: boolean;
}

/**
 * What a shift would cost the facility, in words (M11-04), from the server, which prices it with
 * the same functions that price the invoice. Nothing is worked out in the browser: a figure the
 * screen computed for itself would be a third calculation to keep in step with the other two.
 *
 * `undefined` while there is nothing to ask about or the answer is on its way; `null` when the
 * times cannot be priced. A refused or failed request also reads as `undefined`, because a missing
 * estimate must never stop somebody publishing a shift.
 */
export function useShiftEstimate(input: ShiftEstimateInput): DescribedEstimate | null | undefined {
  // A string, not an array: a new array every render would never settle.
  const times = useSettled(
    input.startsAt && input.endsAt ? `${input.startsAt.toISOString()}|${input.endsAt.toISOString()}` : null,
    400,
  );
  const rate = useSettled(input.hourlyRateKobo, 400);
  const headcount = useSettled(input.headcount, 400);

  const askable =
    Boolean(input.facilityId) &&
    input.allowed !== false &&
    times !== null &&
    Number.isInteger(rate) &&
    rate > 0 &&
    Number.isInteger(headcount) &&
    headcount >= 1 &&
    headcount <= MAX_HEADCOUNT;

  const query = useQuery({
    queryKey: ['shift-estimate', input.facilityId, times, rate, headcount],
    queryFn: async () => {
      const [startsAt, endsAt] = times!.split('|');
      const params = new URLSearchParams({
        facilityId: input.facilityId!,
        startsAt: startsAt!,
        endsAt: endsAt!,
        hourlyRateKobo: String(rate),
        headcount: String(headcount),
      });
      const body = await api.get<{ estimate: DescribedEstimate | null }>(
        `/api/v1/service-requests/estimate?${params}`,
      );
      return body.estimate;
    },
    enabled: askable,
    retry: false,
    staleTime: 60_000,
  });

  return askable ? query.data : undefined;
}
