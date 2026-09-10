// Route table for facilities. Each entry names the permission and the scope
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
 * The :id routes are checked against FACILITY:<id> from the URL. A PLATFORM
 * grant satisfies those too, through isAuthorized's existing PLATFORM rule,
 * which is why operations needs no separate route to reach any facility.
 */
export const ROUTES: RouteDefinition[] = [
  { method: 'POST', path: '/api/v1/facilities', permission: 'facility.write', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/facilities', permission: 'facility.read', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/facilities', permission: 'facility.read', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/facilities/:id', permission: 'facility.read', scopeType: 'FACILITY' },
  { method: 'PATCH', path: '/api/v1/facilities/:id', permission: 'facility.write', scopeType: 'FACILITY' },
  {
    method: 'POST',
    path: '/api/v1/facilities/:id/licence-upload-url',
    permission: 'facility.write',
    scopeType: 'FACILITY',
  },
  {
    method: 'POST',
    path: '/api/v1/facilities/:id/licence-url',
    permission: 'facility.read',
    scopeType: 'FACILITY',
  },
  {
    method: 'POST',
    path: '/api/v1/facilities/:id/verify',
    permission: 'facility.verify',
    scopeType: 'PLATFORM',
  },
];
