import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { handleSessionRequest } from '@/lib/http/session-handler';
import { submitAccountSchema } from '@/modules/billing-settlement/presentation/account-schemas';
import {
  myPayoutAccount,
  submitPayoutAccount,
} from '@/modules/billing-settlement/application/payout-account';

/**
 * The signed-in practitioner's own payout account.
 *
 * GET shows what they have given and where it stands, never the number. POST gives
 * one, and asks for the password again: it is where their pay will go, which is what
 * a stolen laptop with an open session is used to change. The person is the session's
 * and never a parameter's.
 */
export async function GET(request: Request) {
  return handleSessionRequest(request, (session) => myPayoutAccount(session.userId));
}

export async function POST(request: Request) {
  return handleGuardedRequest(request, {
    source: 'body',
    schema: submitAccountSchema,
    permission: 'payout.account.change',
    scope: (_input, session) => ({ type: 'SELF', id: session.userId }),
    successStatus: 201,
    action: async ({ input, session }) => submitPayoutAccount({ ...input, userId: session.userId }),
  });
}
