import { describeEstimate, estimateShift, type DescribedEstimate, type EstimateAudience } from '../domain/estimate';
import { holidayDatesFor } from './holiday';
import { rateTermsFor } from './rate-card';

/**
 * What a shift will come to, in words, for somebody about to agree to it (M11-04).
 *
 * Priced on the allowances the facility has in force on the shift's date: the same card that
 * confirming a booking copies onto it, read the same way, so what is shown is what the booking
 * will be priced on unless the facility changes its card in between, which affects only shifts
 * that start after the change. The calendar is the one a timesheet reads.
 *
 * Null when the shift cannot be priced (it ends before it starts, runs over a day, or has no
 * rate): saying nothing is better than saying nought.
 */
export async function describeShiftEstimate(input: {
  facilityId: string;
  startsAt: Date;
  endsAt: Date;
  hourlyRateKobo: number;
  audience: EstimateAudience;
  headcount?: number;
  now?: Date;
}): Promise<DescribedEstimate | null> {
  const [terms, holidayDates] = await Promise.all([
    rateTermsFor(input.facilityId, input.startsAt, input.now),
    holidayDatesFor(input.startsAt, input.endsAt),
  ]);

  const estimate = estimateShift({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    hourlyRateKobo: input.hourlyRateKobo,
    terms,
    holidayDates,
  });
  return estimate ? describeEstimate(estimate, { audience: input.audience, headcount: input.headcount }) : null;
}
