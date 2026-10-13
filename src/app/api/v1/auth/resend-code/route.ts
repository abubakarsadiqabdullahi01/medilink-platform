import { prisma } from '@/lib/db';
import { normalizeNigerianPhone } from '@/lib/phone';
import { handleAuthRequest } from '@/modules/auth/presentation/handler';
import { resendSchema } from '@/modules/auth/presentation/schemas';
import { issueOtp } from '@/modules/auth/application/otp-service';
import { AuthError } from '@/modules/auth/domain/errors';

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
        try {
          await issueOtp({
            userId: user.id,
            phone,
            purpose: input.purpose,
            ipAddress: context.ipAddress,
          });
        } catch (error) {
          // A gateway that is down would otherwise answer 503 for a registered
          // number and 202 for an unknown one, which tells anybody asking which
          // numbers have accounts. The failure is audited and logged by
          // issueOtp; everything else (throttling included) still propagates.
          if (!(error instanceof AuthError) || error.code !== 'sms_unavailable') throw error;
        }
      }

      return { status: 'code_sent_if_registered' };
    },
    202,
  );
}
