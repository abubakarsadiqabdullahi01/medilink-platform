import { handleAuthRequest } from '@/modules/auth/presentation/handler';
import { verifyPhoneSchema } from '@/modules/auth/presentation/schemas';
import { verifyRegistrationPhone } from '@/modules/auth/application/registration';

/** POST /api/v1/auth/verify-phone — proves control of the number. */
export async function POST(request: Request) {
  return handleAuthRequest(request, verifyPhoneSchema, async (input, context) => {
    const result = await verifyRegistrationPhone({
      phone: input.phone,
      code: input.code,
      ipAddress: context.ipAddress,
    });
    return {
      status: 'phone_verified',
      nextStep: result.passwordSet ? 'login' : 'set_password',
      // Required by set-password. Null when there is no password step to take.
      setupToken: result.setupToken,
    };
  });
}
