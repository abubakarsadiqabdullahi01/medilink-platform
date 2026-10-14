import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { queueSchema } from '@/modules/billing-settlement/presentation/account-schemas';
import { awaitingVerification } from '@/modules/billing-settlement/application/payout-account';

/**
 * GET /api/v1/payout-accounts — the accounts waiting for a finance officer to check
 * them, oldest first. Masked: a name, a bank and the last four digits, which is what
 * is needed to decide whom to open. Opening the whole number is a separate, audited
 * act that asks for the password (see practitioner/[id]).
 */
export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: queueSchema,
    permission: 'invoice.read',
    scope: () => ({ type: 'PLATFORM' }),
    action: async () => ({ accounts: await awaitingVerification() }),
  });
}
