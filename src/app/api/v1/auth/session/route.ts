import { prisma } from '@/lib/db';
import { requestContextFrom } from '@/lib/http/request-context';
import { fail, ok } from '@/lib/http/responses';
import { currentSession } from '@/modules/auth/application/session-service';
import { loadGrants } from '@/lib/authz/guard';

/**
 * GET /api/v1/auth/session — who the caller is and what they may do.
 *
 * Returns permissions rather than roles: the client should hide a button
 * because the permission is absent, matching the server-side check exactly.
 */
export async function GET(request: Request) {
  const context = requestContextFrom(request);
  const session = await currentSession();

  if (!session) {
    return fail('not_authenticated', 'Sign in to continue.', context, 401);
  }

  const [user, grants] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, fullName: true, phone: true, email: true, status: true },
    }),
    loadGrants(session.userId),
  ]);

  if (!user) {
    return fail('not_authenticated', 'Sign in to continue.', context, 401);
  }

  return ok(
    {
      user,
      stepUpFresh: session.stepUpFresh,
      permissions: [...new Set(grants.map((grant) => grant.permission))].sort(),
      grants: grants.map((grant) => ({
        permission: grant.permission,
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
      })),
    },
    context,
  );
}
