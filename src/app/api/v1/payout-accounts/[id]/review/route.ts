import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { reviewAccountSchema } from '@/modules/billing-settlement/presentation/account-schemas';
import { reviewPayoutAccount } from '@/modules/billing-settlement/application/payout-account';

/**
 * POST /api/v1/payout-accounts/:id/review — verify or refuse an account somebody has
 * given. The practitioner holding it cannot: `payout.manage` is a platform
 * permission, and verifying one's own account is the thing this exists to prevent.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return handleGuardedRequest(
    request,
    {
      source: 'body',
      schema: reviewAccountSchema,
      permission: 'payout.manage',
      scope: () => ({ type: 'PLATFORM' }),
      action: async ({ input, session }) =>
        reviewPayoutAccount({
          accountId: input.id,
          actorId: session.userId,
          decision: input.decision,
          note: input.note,
          overrideReason: input.overrideReason,
        }),
    },
    params,
  );
}
