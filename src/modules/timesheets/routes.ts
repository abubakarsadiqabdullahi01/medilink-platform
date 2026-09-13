// Route table for timesheets. Each entry names the permission and the scope
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
 * The practitioner submits and the facility decides, so submission is SELF
 * and review is FACILITY. Correcting is the facility's too: a correction is
 * taken from the ward record, which is the facility's to hold.
 */
export const ROUTES: RouteDefinition[] = [
  {
    method: 'POST',
    path: '/api/v1/assignments/:id/timesheet/submit',
    permission: 'timesheet.submit',
    scopeType: 'SELF',
  },
  {
    method: 'POST',
    path: '/api/v1/assignments/:id/timesheet/review',
    permission: 'timesheet.approve',
    scopeType: 'FACILITY',
  },
  {
    method: 'POST',
    path: '/api/v1/assignments/:id/timesheet/correct',
    permission: 'timesheet.approve',
    scopeType: 'FACILITY',
  },
  {
    method: 'GET',
    path: '/api/v1/assignments/:id/timesheet',
    permission: 'service_request.read',
    scopeType: 'SELF',
  },
  {
    method: 'GET',
    path: '/api/v1/assignments/:id/timesheet',
    permission: 'service_request.read',
    scopeType: 'FACILITY',
  },
];
