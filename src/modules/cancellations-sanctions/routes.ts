// Route table for cancellations, no-shows and sanctions. Each entry names the
// permission and the scope type it is checked against.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  scopeType: ScopeType;
}

/**
 * Fault is decided at PLATFORM scope, not by the facility. A facility
 * deciding whether its own practitioner was at fault for a shift that facility
 * failed to open is not a finding anyone should rely on.
 */
export const ROUTES: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/api/v1/unhonoured',
    permission: 'sanction.apply',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/assignments/:id/fault',
    permission: 'sanction.apply',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/assignments/:id/excusals',
    permission: 'attendance.record',
    scopeType: 'SELF',
  },
  {
    method: 'GET',
    path: '/api/v1/assignments/:id/excusals',
    permission: 'attendance.record',
    scopeType: 'SELF',
  },
  // The officer deciding the flag reads the same list, at PLATFORM, with
  // ?scopeType=PLATFORM. The SELF reading also checks the shift is theirs.
  {
    method: 'GET',
    path: '/api/v1/assignments/:id/excusals',
    permission: 'sanction.apply',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/excusals/:id/decide',
    permission: 'sanction.apply',
    scopeType: 'PLATFORM',
  },
];
