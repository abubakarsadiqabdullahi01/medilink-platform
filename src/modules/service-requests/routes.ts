// Route table for service requests. Each entry names the permission and the
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
 * Every write is scoped to the facility the request belongs to, named by the
 * caller and checked before any database read. A PLATFORM grant satisfies the
 * same check, which is how operations reaches any facility's requests.
 *
 * Cancelling uses `service_request.publish` rather than `assignment.cancel`:
 * whoever may put work in front of practitioners is who may withdraw it, and
 * `assignment.cancel` is about a confirmed person, not an open request.
 */
export const ROUTES: RouteDefinition[] = [
  {
    method: 'POST',
    path: '/api/v1/service-requests',
    permission: 'service_request.publish',
    scopeType: 'FACILITY',
  },
  {
    method: 'GET',
    path: '/api/v1/service-requests',
    permission: 'service_request.read',
    scopeType: 'FACILITY',
  },
  {
    method: 'GET',
    path: '/api/v1/service-requests',
    permission: 'service_request.read',
    scopeType: 'PLATFORM',
  },
  {
    method: 'GET',
    path: '/api/v1/service-requests/:id',
    permission: 'service_request.read',
    scopeType: 'FACILITY',
  },
  {
    method: 'POST',
    path: '/api/v1/service-requests/:id/publish',
    permission: 'service_request.publish',
    scopeType: 'FACILITY',
  },
  {
    method: 'POST',
    path: '/api/v1/service-requests/:id/cancel',
    permission: 'service_request.publish',
    scopeType: 'FACILITY',
  },
];
