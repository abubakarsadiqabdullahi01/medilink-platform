import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import {
  myPayoutsSchema,
  preparePayoutSchema,
} from '@/modules/billing-settlement/presentation/schemas';
import {
  amountOwed,
  listPayouts,
  preparePayout,
} from '@/modules/billing-settlement/application/payout';

/**
 * POST /api/v1/payouts — prepare one for everything a practitioner is owed.
 *
 * Preparing moves nothing. It proposes clearing a balance the ledger already
 * shows, and a person releases it separately — the gap between the two is
 * where an authorise-then-capture provider slots in once step 3.3 is settled.
 */
export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: preparePayoutSchema,
    permission: 'payout.manage',
    scope: () => ({ type: 'PLATFORM' }),
    action: async ({ input, session }) =>
      preparePayout({ practitionerId: input.practitionerId, actorId: session.userId }),
  });
}

/** GET — a practitioner's own payouts, or an officer reading somebody's. */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: myPayoutsSchema,
    permission: 'invoice.read',
    scope: (input, session) => ({
      type: input.scopeType,
      id: input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : input.scopeId,
    }),
    action: async ({ input, session }) => {
      const practitionerId =
        input.scopeType === 'SELF' ? (input.scopeId ?? session.userId) : (input.scopeId as string);
      // What is credited and not yet paid out, from the ledger — the number a
      // practitioner opens the page to read, and the one no list of payouts
      // can give them.
      const [payouts, owedKobo] = await Promise.all([
        listPayouts(practitionerId),
        amountOwed(practitionerId),
      ]);
      return { payouts, owedKobo };
    },
  });
}
