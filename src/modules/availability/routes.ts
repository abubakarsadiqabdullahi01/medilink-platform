// Route table for availability. Each entry names the permission and the scope
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
 * Writing is SELF-only, always: a practitioner's availability is a statement
 * they make about themselves, and nobody else should be able to say they are
 * free. Reading is also open at PLATFORM, for operations working an unfilled
 * shift.
 */
export const ROUTES: RouteDefinition[] = [
  { method: 'GET', path: '/api/v1/availability', permission: 'availability.read', scopeType: 'SELF' },
  {
    method: 'GET',
    path: '/api/v1/availability',
    permission: 'availability.read',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/availability/slots',
    permission: 'availability.write',
    scopeType: 'SELF',
  },
  {
    method: 'DELETE',
    path: '/api/v1/availability/slots/:id',
    permission: 'availability.write',
    scopeType: 'SELF',
  },
  {
    method: 'POST',
    path: '/api/v1/availability/blocks',
    permission: 'availability.write',
    scopeType: 'SELF',
  },
  {
    method: 'DELETE',
    path: '/api/v1/availability/blocks/:id',
    permission: 'availability.write',
    scopeType: 'SELF',
  },
];
