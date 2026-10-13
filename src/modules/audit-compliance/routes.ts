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
  // Consent and agreements are the subject's own, so SELF throughout. An
  // officer wanting to know whether somebody consented reads the audit trail,
  // which says who changed it and when.
  { method: 'GET', path: '/api/v1/consent', permission: 'practitioner.profile.read', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/consent', permission: 'practitioner.profile.write', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/agreements', permission: 'practitioner.profile.read', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/agreements', permission: 'practitioner.profile.write', scopeType: 'SELF' },
  { method: 'PATCH', path: '/api/v1/agreements', permission: 'config.manage', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/admin/performance', permission: 'audit.read', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/agreements/versions', permission: 'config.manage', scopeType: 'PLATFORM' },
  // A facility's terms are accepted by a person acting for it, so the scope is
  // the facility while the acceptance carries the person's id.
  { method: 'GET', path: '/api/v1/agreements/facility', permission: 'facility.read', scopeType: 'FACILITY' },
  { method: 'POST', path: '/api/v1/agreements/facility', permission: 'facility.read', scopeType: 'FACILITY' },
  // SELF only, deliberately: an officer who could export anybody would have a
  // one-request dossier on every practitioner on the platform.
  { method: 'GET', path: '/api/v1/me/export', permission: 'practitioner.profile.read', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/me/erasure', permission: 'practitioner.profile.read', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/me/data-requests', permission: 'practitioner.profile.read', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/data-requests', permission: 'practitioner.profile.write', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/data-requests', permission: 'audit.read', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/data-requests/:id/start', permission: 'audit.read', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/data-requests/:id/close', permission: 'audit.read', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/data-requests/:id/erase', permission: 'data.erase', scopeType: 'PLATFORM' },

  { method: 'GET', path: '/api/v1/admin/system', permission: 'audit.read', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/admin/system/events/:id/replay', permission: 'system.manage', scopeType: 'PLATFORM' },

  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'FACILITY_GROUP' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'BRANCH' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'DEPARTMENT' },
  { method: 'GET', path: '/api/v1/audit', permission: 'audit.read', scopeType: 'SELF' },
];
