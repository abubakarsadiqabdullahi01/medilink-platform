// Route table for audit compliance. Each entry names the permission and the scope
// type it is checked against, so authorisation is reviewable in one place.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  /**
   * The scope types this route accepts. The caller names one per request and
   * must hold the permission over it; a grant at PLATFORM covers them all.
   */
  scopeType: ScopeType;
}

export const ROUTES: RouteDefinition[] = [
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'FACILITY_GROUP' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'BRANCH' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'DEPARTMENT' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'SELF' },
];
