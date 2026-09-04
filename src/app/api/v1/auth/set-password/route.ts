import { handleAuthRequest } from '@/modules/auth/presentation/handler';
import { setPasswordSchema } from '@/modules/auth/presentation/schemas';
import { setInitialPassword } from '@/modules/auth/application/registration';

/**
 * POST /api/v1/auth/set-password — final registration step.
 *
 * Deliberately does not issue a session. The account moves to UNDER_REVIEW
 * and cannot accept shifts until credentialling completes in Stage 5, so
 * signing the user straight in would misrepresent their status.
 */
export async function POST(request: Request) {
  return handleAuthRequest(request, setPasswordSchema, async (input, context) => {
    await setInitialPassword({
      phone: input.phone,
      password: input.password,
      ipAddress: context.ipAddress,
    });
    return { status: 'password_set', accountStatus: 'UNDER_REVIEW', nextStep: 'login' };
  });
}
