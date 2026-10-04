// Route table for matching. Each entry names the permission and the scope
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
  {
    method: 'POST',
    path: '/api/v1/service-requests/:id/match',
    permission: 'assignment.confirm',
    scopeType: 'FACILITY',
  },
  {
    method: 'GET',
    path: '/api/v1/match-runs/:id',
    permission: 'service_request.read',
    scopeType: 'FACILITY',
  },
  {
    method: 'POST',
    path: '/api/v1/service-requests/:id/invite',
    permission: 'assignment.confirm',
    scopeType: 'FACILITY',
  },
  {
    method: 'GET',
    path: '/api/v1/service-requests/:id/invitations',
    permission: 'service_request.read',
    scopeType: 'FACILITY',
  },
  {
    method: 'POST',
    path: '/api/v1/service-requests/:id/confirm',
    permission: 'assignment.confirm',
    scopeType: 'FACILITY',
  },
  // The practitioner's own side: answering, and seeing what they hold.
  {
    method: 'GET',
    path: '/api/v1/invitations',
    permission: 'service_request.read',
    scopeType: 'SELF',
  },
  {
    method: 'POST',
    path: '/api/v1/invitations/:id/respond',
    permission: 'service_request.read',
    scopeType: 'SELF',
  },
  { method: 'GET', path: '/api/v1/assignments', permission: 'service_request.read', scopeType: 'SELF' },
  {
    method: 'GET',
    path: '/api/v1/assignments',
    permission: 'service_request.read',
    scopeType: 'FACILITY',
  },
  {
    method: 'POST',
    path: '/api/v1/assignments/:id/cancel',
    permission: 'assignment.cancel',
    scopeType: 'FACILITY',
  },
];
