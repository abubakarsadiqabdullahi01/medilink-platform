import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  addHolidaySchema,
  listHolidaysSchema,
} from '@/modules/rates-contracts/presentation/holiday-schemas';
import {
  addHoliday,
  holidayCoverageNow,
  listHolidays,
} from '@/modules/rates-contracts/application/holiday';

/**
 * The public holidays the holiday premium is paid on.
 *
 * `config.manage` at PLATFORM for both reading and writing: a date added here
 * changes what every facility is billed and every practitioner is paid for a
 * shift on that day, so it is a policy edit like a rate floor and is held by the
 * same people.
 */

/** GET — a year's holidays (or all of them), and whether the list will last. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listHolidaysSchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input }) => ({
      holidays: await listHolidays(input.year),
      coverage: await holidayCoverageNow(),
    }),
  });
}

/** POST — add a holiday: a declared one (Eid, a substitute Monday) or one the list lacks. */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: addHolidaySchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) => addHoliday({ ...input, actorId: session.userId }),
  });
}
