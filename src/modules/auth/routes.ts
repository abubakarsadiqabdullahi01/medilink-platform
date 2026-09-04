// Route table for auth. Each entry names the permission and the scope
// type it is checked against, so authorisation is reviewable in one place.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  scopeType: ScopeType;
}

/**
 * The Stage 4.2 endpoints are all unauthenticated by design — they are how a
 * caller becomes authenticated — or act only on the caller's own session.
 * They are listed here so a reviewer can see that the omission is deliberate
 * rather than an oversight.
 */
export const PUBLIC_ROUTES = [
  { method: 'POST', path: '/api/v1/auth/register' },
  { method: 'POST', path: '/api/v1/auth/verify-phone' },
  { method: 'POST', path: '/api/v1/auth/set-password' },
  { method: 'POST', path: '/api/v1/auth/login' },
  { method: 'POST', path: '/api/v1/auth/resend-code' },
  { method: 'POST', path: '/api/v1/auth/password/reset-request' },
  { method: 'POST', path: '/api/v1/auth/password/reset-confirm' },
] as const;

/** Requires a session, but no permission beyond owning that session. */
export const SESSION_ROUTES = [
  { method: 'GET', path: '/api/v1/auth/session' },
  { method: 'POST', path: '/api/v1/auth/logout' },
] as const;

export const ROUTES: RouteDefinition[] = [];
