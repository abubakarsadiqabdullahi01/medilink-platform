import { prisma } from '@/lib/db';
import { loadGrants } from '@/lib/authz/guard';
import { currentSession } from './session-service';

/**
 * Who is signed in and what they may do, in the shape the console reads.
 *
 * One function for the two places that need it: `GET /api/v1/auth/session`,
 * and the console layouts, which put the answer into the first HTML so the
 * navigation is on screen before any script has run instead of after a round
 * trip that could only start once the scripts had. Returns permissions rather
 * than roles, so the console hides a control for the same reason the server
 * would refuse it.
 */
export interface SessionStateView {
  user: { id: string; fullName: string; phone: string; email: string | null; status: string };
  stepUpFresh: boolean;
  permissions: string[];
  grants: { permission: string; scopeType: string; scopeId: string | null }[];
}

export async function sessionState(): Promise<SessionStateView | null> {
  const session = await currentSession();
  if (!session) return null;

  const [user, grants] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, fullName: true, phone: true, email: true, status: true },
    }),
    loadGrants(session.userId),
  ]);
  if (!user) return null;

  return {
    user,
    stepUpFresh: session.stepUpFresh,
    permissions: [...new Set(grants.map((grant) => grant.permission))].sort(),
    grants: grants.map((grant) => ({
      permission: grant.permission,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
    })),
  };
}
