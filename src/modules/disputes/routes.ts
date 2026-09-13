// Route table for disputes. Each entry names the permission and the scope
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
 * Raising is a party's act, so SELF or FACILITY; adjudicating is PLATFORM.
 * An operations officer holding `dispute.manage` at PLATFORM can resolve a
 * case and cannot open one — `partyFor` returns null for them, which
 * `openBlockers` turns into `not_a_party`.
 */
export const ROUTES: RouteDefinition[] = [
  { method: 'POST', path: '/api/v1/assignments/:id/disputes', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/assignments/:id/disputes', permission: 'dispute.manage', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/assignments/:id/disputes', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/assignments/:id/disputes', permission: 'dispute.manage', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/disputes', permission: 'dispute.manage', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/disputes/:id', permission: 'dispute.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/disputes/:id/review', permission: 'dispute.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/disputes/:id/resolve', permission: 'dispute.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/disputes/:id/withdraw', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/disputes/:id/evidence/upload-url', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/disputes/:id/evidence', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/disputes/:id/evidence', permission: 'dispute.manage', scopeType: 'PLATFORM' },
];
