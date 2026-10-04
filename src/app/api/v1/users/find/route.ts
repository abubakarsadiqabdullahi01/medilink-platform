import { z } from 'zod';
import { handleGuardedRequest } from '@/lib/http/guarded-handler';
import { isNigerianPhone, normalizeNigerianPhone } from '@/lib/phone';
import { findUserByPhone } from '@/modules/auth/application/grants';

/**
 * GET /api/v1/users/find — look somebody up by the number they registered with.
 *
 * `/grants/find` answers the same question behind `role.grant`, which is the
 * permission for handing out access. Compliance does not hold it and should
 * not need it: recording somebody's identity is not granting them anything.
 * So this sits behind `user.read` at PLATFORM instead.
 *
 * By phone, one at a time, on purpose. Nothing in this product lists
 * practitioners and this is not that: an officer has the person in front of
 * them or on the line. A browsable roster of everybody on the platform is a
 * different feature with different consequences, and it should be decided
 * rather than arrived at.
 */
const findSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(7)
    .max(20)
    .refine(isNigerianPhone, 'Enter a Nigerian mobile number, for example 0803 123 4567.'),
});

export async function GET(request: Request) {
  return handleGuardedRequest(request, {
    source: 'query',
    schema: findSchema,
    permission: 'user.read',
    scope: () => ({ type: 'PLATFORM' }),
    // Normalised here because registration stores +234…, and an officer
    // reading a number off a slip will type whatever is written on it.
    action: async ({ input }) => findUserByPhone(normalizeNigerianPhone(input.phone)),
  });
}
