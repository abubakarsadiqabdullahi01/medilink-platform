import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { accountIdSchema } from '@/modules/billing-settlement/presentation/account-schemas';
import { payoutAccountsForOfficer } from '@/modules/billing-settlement/application/payout-account';

/**
 * GET /api/v1/payout-accounts/practitioner/:id — where to pay somebody, with the
 * number opened.
 *
 * `payout.manage` because it is what finance needs to make a transfer, and that
 * permission asks for the password again; every read is written to the audit trail
 * with who looked and for whom, and never with the number.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'query',
      schema: accountIdSchema,
      permission: 'payout.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        payoutAccountsForOfficer({ practitionerId: input.id, actorId: session.userId }),
    },
    params,
  );
}
