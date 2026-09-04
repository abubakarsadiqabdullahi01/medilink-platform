import { handleAuthRequest } from '@/modules/auth/presentation/handler';
import { loginSchema } from '@/modules/auth/presentation/schemas';
import { login } from '@/modules/auth/application/login';

/** POST /api/v1/auth/login — password login, sets the session cookie. */
export async function POST(request: Request) {
  return handleAuthRequest(request, loginSchema, async (input, context) => {
    const session = await login({
      phone: input.phone,
      password: input.password,
      ipAddress: context.ipAddress,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
    return { status: 'authenticated', expiresAt: session.expiresAt.toISOString() };
  });
}
