import { prisma } from '@/lib/db';
import { normalizeNigerianPhone } from '@/lib/phone';
import { handleAuthRequest } from '@/modules/auth/presentation/handler';
import { resendSchema } from '@/modules/auth/presentation/schemas';
import { issueOtp } from '@/modules/auth/application/otp-service';

/**
 * POST /api/v1/auth/resend-code
 *
 * Throttling lives in the domain policy, so this route cannot become a way to
 * run up an SMS bill. An unknown number returns the same accepted response.
 */
export async function POST(request: Request) {
  return handleAuthRequest(
    request,
    resendSchema,
    async (input, context) => {
      const phone = normalizeNigerianPhone(input.phone);
      const user = await prisma.user.findUnique({
        where: { phone },
        select: { id: true, deletedAt: true, status: true },
      });

      if (
        user &&
        !user.deletedAt &&
        user.status !== 'SUSPENDED' &&
        user.status !== 'DEACTIVATED'
      ) {
        await issueOtp({
          userId: user.id,
          phone,
          purpose: input.purpose,
          ipAddress: context.ipAddress,
        });
      }

      return { status: 'code_sent_if_registered' };
    },
    202,
  );
}
