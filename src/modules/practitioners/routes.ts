// Route table for practitioners. Each entry names the permission and the scope
// type it is checked against, so authorisation is reviewable in one place.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  scopeType: ScopeType;
}

export const ROUTES: RouteDefinition[] = [
  { method: 'GET', path: '/api/v1/practitioners/me', permission: 'practitioner.profile.read', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/practitioners/me', permission: 'practitioner.profile.write', scopeType: 'SELF' },
  { method: 'PATCH', path: '/api/v1/practitioners/me', permission: 'practitioner.profile.write', scopeType: 'SELF' },
  {
    method: 'POST',
    path: '/api/v1/practitioners/me/photo-upload-url',
    permission: 'practitioner.profile.write',
    scopeType: 'SELF',
  },
];
