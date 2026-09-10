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
  // Steps 5.3 and 5.5. Recording is PLATFORM-only — a practitioner does not
  // verify their own identity or licence, which is the point of the step.
  {
    method: 'GET',
    path: '/api/v1/practitioners/verification',
    permission: 'practitioner.profile.read',
    scopeType: 'SELF',
  },
  {
    method: 'GET',
    path: '/api/v1/practitioners/verification',
    permission: 'practitioner.profile.read',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/practitioners/verification/identity',
    permission: 'credential.review',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/practitioners/verification/registration',
    permission: 'credential.review',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/practitioners/me/photo-upload-url',
    permission: 'practitioner.profile.write',
    scopeType: 'SELF',
  },
  // Step 5.8. Read-only: activation itself only happens on the nightly
  // sweep, never as a side effect of this endpoint.
  {
    method: 'GET',
    path: '/api/v1/practitioners/eligibility',
    permission: 'practitioner.profile.read',
    scopeType: 'SELF',
  },
  {
    method: 'GET',
    path: '/api/v1/practitioners/eligibility',
    permission: 'practitioner.profile.read',
    scopeType: 'PLATFORM',
  },
];
