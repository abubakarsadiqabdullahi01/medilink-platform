// Route table for attendance. Each entry names the permission and the scope
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
 * Issuing a token is the facility's act and presenting it is the
 * practitioner's — that direction is what makes the token evidence of
 * presence rather than proof that somebody owns a phone. So issuing is
 * FACILITY-scoped and presenting is SELF.
 */
export const ROUTES: RouteDefinition[] = [
  {
    method: 'POST',
    path: '/api/v1/assignments/:id/attendance/token',
    permission: 'attendance.record',
    scopeType: 'FACILITY',
  },
  {
    method: 'POST',
    path: '/api/v1/assignments/:id/attendance/present',
    permission: 'attendance.record',
    scopeType: 'SELF',
  },
  {
    method: 'POST',
    path: '/api/v1/assignments/:id/attendance/manual',
    permission: 'attendance.record',
    scopeType: 'FACILITY',
  },
  {
    method: 'GET',
    path: '/api/v1/assignments/:id/attendance',
    permission: 'service_request.read',
    scopeType: 'SELF',
  },
  {
    method: 'GET',
    path: '/api/v1/assignments/:id/attendance',
    permission: 'service_request.read',
    scopeType: 'FACILITY',
  },
];
