import { handleAuthRequest } from '@/modules/auth/presentation/handler';
import { resetRequestSchema } from '@/modules/auth/presentation/schemas';
import { requestPasswordReset } from '@/modules/auth/application/recovery';

/**
 * POST /api/v1/auth/password/reset-request
 *
 * Always 202 with the same body, whether or not the number is registered.
 */
export async function POST(request: Request) {
  return handleAuthRequest(
    request,
    resetRequestSchema,
    async (input, context) => {
      await requestPasswordReset({ phone: input.phone, ipAddress: context.ipAddress });
      return { status: 'code_sent_if_registered' };
    },
    202,
  );
}
