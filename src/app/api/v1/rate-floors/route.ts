import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  listRateFloorsSchema,
  setRateFloorSchema,
} from '@/modules/rates-contracts/presentation/rate-floor-schemas';
import { rateFloorOverview, setRateFloor } from '@/modules/rates-contracts/application/rate-floor';

/**
 * The minimum hourly rates a shift may be published at.
 *
 * `config.manage` at PLATFORM for both reading and writing: a floor changes what
 * every facility may offer and every practitioner is guaranteed, so it is a policy
 * edit held by the same people as the holiday list. A profession with no floor
 * cannot have a shift published, and the overview lists exactly which are missing.
 */

/** GET — every floor, and every profession and shift type that has none in force. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listRateFloorsSchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => rateFloorOverview(),
  });
}

/** POST — set a floor from a date; a later one takes over, nothing is edited or deleted. */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: setRateFloorSchema,
    permission: 'config.manage',
    scope: () => ({ type: 'PLATFORM' }),
    successStatus: 201,
    action: async ({ input, session }) => setRateFloor({ ...input, actorId: session.userId }),
  });
}
