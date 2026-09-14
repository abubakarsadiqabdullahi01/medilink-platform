'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/ui/api';

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

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const { data, isPending, isError } = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<SessionState>('/api/v1/auth/session'),
    retry: false,
    staleTime: 60_000,
  });

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    // Redirect during render is not allowed, so this fires on the next tick
    // and the shell renders nothing rather than flashing empty queues.
    queueMicrotask(() => router.replace('/login'));
    return null;
  }

  return <SessionContext.Provider value={data}>{children}</SessionContext.Provider>;
}
