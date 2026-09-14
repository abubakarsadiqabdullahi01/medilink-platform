import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  createRateCardSchema,
  listRateCardsSchema,
} from '@/modules/rates-contracts/presentation/schemas';
import { createRateCard, listRateCards } from '@/modules/rates-contracts/application/rate-card';

/**
 * POST /api/v1/rate-cards — set what this facility pays above the base rate.
 *
 * Creating one supersedes the current card in the same transaction. The old
 * card is kept with its dates, because an invoice raised against it has to
 * stay readable.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: createRateCardSchema,
    permission: 'facility.write',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ input, session }) =>
      createRateCard({ ...input, actorId: session.userId }),
  });
}

/** GET — every card this facility has had, newest first. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: listRateCardsSchema,
    permission: 'facility.read',
    scope: (input) => ({ type: 'FACILITY', id: input.facilityId }),
    action: async ({ input }) => ({ rateCards: await listRateCards(input.facilityId) }),
  });
}
