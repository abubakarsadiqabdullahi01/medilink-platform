import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { estimateShiftSchema } from '@/modules/service-requests/presentation/schemas';
import { describeShiftEstimate } from '@/modules/rates-contracts/application/estimate';

/**
 * GET /api/v1/service-requests/estimate — what a shift would cost this facility, in words, before
 * it is published (M11-04).
 *
 * Priced on the allowances the facility has in force on the shift's date and the calendar a
 * timesheet reads, by the same two functions that price a worked shift. `estimate` is null when the
 * times cannot be priced (the end is before the start, or the shift runs over a day).
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: estimateShiftSchema,
    permission: 'service_request.publish',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ input }) => ({
      estimate: await describeShiftEstimate({
        facilityId: input.facilityId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        hourlyRateKobo: input.hourlyRateKobo,
        audience: 'facility',
        headcount: input.headcount,
      }),
    }),
  });
}
