'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ApiError, api } from '@/lib/ui/api';
import { Button } from '@/components/ui/button';

/**
 * Who is signed in and what they may do.
 *
 * The session endpoint returns **permissions rather than roles**, and this
 * carries them through unchanged. The console hides a control because the
 * permission is absent, which is the same question the server asks — a menu
 * built from role names would drift from the guard the first time a bundle
 * changed.
 *
 * Hiding is a courtesy, never a control. Every endpoint refuses on its own;
 * nothing here is load-bearing for security.
 */

export interface SessionUser {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: string;
}

export interface SessionState {
  user: SessionUser;
  permissions: string[];
  stepUpFresh: boolean;
  grants: { permission: string; scopeType: string; scopeId: string | null }[];
}

/**
 * Which console an account opens into.
 *
 * Decided by the grants rather than by a role name, and shared by signing in
 * and signing up so the two cannot disagree about where somebody lands.
 */
export function consoleFor(session: SessionState): string {
  const scopes = new Set(session.grants.map((grant) => grant.scopeType));
  if (scopes.has('PLATFORM')) return '/admin';
  if (scopes.has('FACILITY')) return '/facility';
  // No grants at all is a staff account nobody has added yet: a practitioner
  // always holds the SELF grant registration gives them. The facility console
  // is where such an account learns what to do next, whereas the practitioner
  // console would open with every page refusing it.
  if (session.grants.length === 0) return '/facility';
  return '/practitioner';
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession used outside a signed-in shell');
  return session;
}

export function useCan(permission: string): boolean {
  return useSession().permissions.includes(permission);
}

/**
 * The scopes a permission is held at.
 *
 * A facility user holds their permissions at one or more `FACILITY` scopes,
 * and the console has to send that id with the request. Reading it off the
 * grants is what lets a page work for somebody at two hospitals without
 * asking them which they are.
 */
export function useScopeIds(permission: string, scopeType: string): string[] {
  const session = useSession();
  return session.grants
    .filter((grant) => grant.permission === permission && grant.scopeType === scopeType)
    .map((grant) => grant.scopeId)
    .filter((id): id is string => Boolean(id));
}

export function SessionProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /**
   * The session as the server already knew it when it rendered the page. With
   * it the console draws immediately; without it (null: signed out, or a
   * stale cookie) the provider asks, gets its 401, and sends them to sign in.
   */
  initial?: SessionState | null;
}) {
  const router = useRouter();

  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<SessionState>('/api/v1/auth/session'),
    // A refusal is an answer; a timeout or a 5xx is not, and is worth a try.
    retry: (count, failure) => !(failure instanceof ApiError && failure.failure.status < 500) && count < 2,
    staleTime: 60_000,
    ...(initial ? { initialData: initial, initialDataUpdatedAt: Date.now() } : {}),
  });

  // The first load, with nothing to show yet.
  if (!data && isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Signed out is a 401 and nothing else. Anything else with no session to show
  // is the server being slow or unreachable, and sending somebody to the login
  // page for that is wrong twice: it throws away where they were, and a
  // development server compiling a route looks exactly like this.
  if (!data) {
    if (error instanceof ApiError && error.failure.status === 401) {
      // Redirect during render is not allowed, so this fires on the next tick
      // and the shell renders nothing rather than flashing empty queues.
      queueMicrotask(() => router.replace('/login'));
      return null;
    }
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-medium">Could not reach Medilink</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          You are still signed in. The server did not answer, which is usually a moment&apos;s delay.
        </p>
        <Button onClick={() => void refetch()} loading={isFetching}>
          Try again
        </Button>
      </div>
    );
  }

  // With a session in hand the console stays up through any refresh: a
  // background refetch that fails (a blip on focus, a slow reply) leaves the
  // last known session in place rather than blanking or redirecting. Only a
  // 401 — the session really has ended — sends them to sign in again.
  if (error instanceof ApiError && error.failure.status === 401) {
    queueMicrotask(() => router.replace('/login'));
    return null;
  }

  return <SessionContext.Provider value={data}>{children}</SessionContext.Provider>;
}
