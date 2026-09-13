'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/ui/api';

/**
 * Who is signed in and what they may do.
 *
 * The session endpoint returns **permissions rather than roles**, and this
 * carries them through unchanged. The console hides a button because the
 * permission is absent, which is the same question the server asks — a menu
 * built from role names would drift from the guard the first time a bundle
 * changed.
 *
 * Hiding is a courtesy, not a control. Every one of these endpoints refuses
 * the call on its own; nothing here is load-bearing for security.
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

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession used outside the console shell');
  return session;
}

export function useCan(permission: string): boolean {
  return useSession().permissions.includes(permission);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionState | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<SessionState>('/api/v1/auth/session')
      .then((value) => {
        if (!cancelled) setSession(value);
      })
      .catch(() => {
        if (!cancelled) router.replace('/login');
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checked) {
    return <p className="p-8 text-sm text-muted">Loading…</p>;
  }
  if (!session) {
    // The redirect is already in flight; rendering the console for an instant
    // with no session would flash empty queues at somebody signing out.
    return null;
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
