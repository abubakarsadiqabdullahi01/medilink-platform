// Route table for disputes. Each entry names the permission and the scope
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
 * Raising is a party's act, so SELF or FACILITY; adjudicating is PLATFORM.
 * An operations officer holding `dispute.manage` at PLATFORM can resolve a
 * case and cannot open one — `partyFor` returns null for them, which
 * `openBlockers` turns into `not_a_party`.
 */
export const ROUTES: RouteDefinition[] = [
  { method: 'POST', path: '/api/v1/assignments/:id/disputes', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/assignments/:id/disputes', permission: 'dispute.manage', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/assignments/:id/disputes', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/assignments/:id/disputes', permission: 'dispute.manage', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/disputes', permission: 'dispute.manage', scopeType: 'PLATFORM' },
  // With facilityId: the cases over that facility's own shifts.
  { method: 'GET', path: '/api/v1/disputes', permission: 'dispute.manage', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/disputes/:id', permission: 'dispute.manage', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/disputes/:id', permission: 'dispute.manage', scopeType: 'FACILITY' },
  // A practitioner reading their own case, as themselves.
  { method: 'GET', path: '/api/v1/disputes/:id', permission: 'dispute.manage', scopeType: 'SELF' },
  // Every case over the practitioner's own shifts. No id: whose it is comes from the session.
  { method: 'GET', path: '/api/v1/disputes/mine', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/disputes/:id/review', permission: 'dispute.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/disputes/:id/resolve', permission: 'dispute.manage', scopeType: 'PLATFORM' },
  // A party acts as themselves (SELF) or, for a facility, as the facility they name
  // (FACILITY): the same route, the scope chosen by whether `facilityId` is given.
  { method: 'POST', path: '/api/v1/disputes/:id/withdraw', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/disputes/:id/withdraw', permission: 'dispute.manage', scopeType: 'FACILITY' },
  // The other side's one written reply: SELF for a practitioner, FACILITY for the facility.
  { method: 'POST', path: '/api/v1/disputes/:id/respond', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/disputes/:id/respond', permission: 'dispute.manage', scopeType: 'FACILITY' },
  { method: 'POST', path: '/api/v1/disputes/:id/evidence/upload-url', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/disputes/:id/evidence/upload-url', permission: 'dispute.manage', scopeType: 'FACILITY' },
  { method: 'POST', path: '/api/v1/disputes/:id/evidence', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/disputes/:id/evidence', permission: 'dispute.manage', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/disputes/:id/evidence', permission: 'dispute.manage', scopeType: 'PLATFORM' },
  // Reading one attachment. SELF because a party may re-read what they or the
  // other side put in; a PLATFORM holder's grant covers every scope, so the
  // adjudicator working the case reaches it through the same entry.
  { method: 'POST', path: '/api/v1/disputes/:id/evidence/:evidenceId/url', permission: 'dispute.manage', scopeType: 'SELF' },
  { method: 'POST', path: '/api/v1/disputes/:id/evidence/:evidenceId/url', permission: 'dispute.manage', scopeType: 'FACILITY' },
];
