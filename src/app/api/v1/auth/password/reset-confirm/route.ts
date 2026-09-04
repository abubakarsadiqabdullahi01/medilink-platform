import { handleAuthRequest } from '@/modules/auth/presentation/handler';
import { resetConfirmSchema } from '@/modules/auth/presentation/schemas';
import { confirmPasswordReset } from '@/modules/auth/application/recovery';

/**
 * POST /api/v1/auth/password/reset-confirm
 *
 * On success every session for the account is revoked, including the caller's.
 */
export async function POST(request: Request) {
  return handleAuthRequest(request, resetConfirmSchema, async (input, context) => {
    const result = await confirmPasswordReset({
      phone: input.phone,
      code: input.code,
      password: input.password,
      ipAddress: context.ipAddress,
    });
    return {
      status: 'password_reset',
      revokedSessions: result.revokedSessions,
      nextStep: 'login',
    };
  });
}
