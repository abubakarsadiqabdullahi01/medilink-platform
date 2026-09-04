import { handleAuthRequest } from '@/modules/auth/presentation/handler';
import { startRegistrationSchema } from '@/modules/auth/presentation/schemas';
import { startRegistration } from '@/modules/auth/application/registration';

/**
 * POST /api/v1/auth/register — claims a phone number and sends a code.
 *
 * The response is identical whether or not the number was already
 * registered; see startRegistration for why.
 */
export async function POST(request: Request) {
  return handleAuthRequest(
    request,
    startRegistrationSchema,
    async (input, context) => {
      const result = await startRegistration({
        phone: input.phone,
        fullName: input.fullName,
        email: input.email,
        ipAddress: context.ipAddress,
      });
      return {
        status: 'code_sent',
        phone: result.phone,
        expiresAt: result.expiresAt.toISOString(),
      };
    },
    202,
  );
}
