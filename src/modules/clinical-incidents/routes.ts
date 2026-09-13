// Route table for clinical incidents. Each entry names the permission and the
// scope type it is checked against, so authorisation is reviewable in one place.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  scopeType: ScopeType;
}

/**
 * Nothing here deletes or edits a report. That is not an oversight: a report
 * that can be withdrawn is one a facility can be pressured into withdrawing,
 * and the whole value of the log is that it holds what people said at the
 * time.
 */
export const ROUTES: RouteDefinition[] = [
  { method: 'POST', path: '/api/v1/incidents', permission: 'incident.report', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/incidents', permission: 'incident.report', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/incidents/queue', permission: 'incident.manage', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/incidents/:id', permission: 'incident.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/incidents/:id/review', permission: 'incident.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/incidents/:id/close', permission: 'incident.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/users/:id/reinstate', permission: 'incident.manage', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/users/:id/suspensions', permission: 'incident.manage', scopeType: 'PLATFORM' },
];
