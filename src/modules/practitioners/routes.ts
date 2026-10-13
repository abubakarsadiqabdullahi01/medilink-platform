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
  // The directory compliance works from. PLATFORM only, with no SELF branch:
  // a practitioner has /practitioners/me and no business enumerating anybody.
  {
    method: 'GET',
    path: '/api/v1/practitioners',
    permission: 'practitioner.profile.read',
    scopeType: 'PLATFORM',
  },
  {
    method: 'GET',
    path: '/api/v1/practitioners/me',
    permission: 'practitioner.profile.read',
    scopeType: 'SELF',
  },
  {
    method: 'POST',
    path: '/api/v1/practitioners/me',
    permission: 'practitioner.profile.write',
    scopeType: 'SELF',
  },
  {
    method: 'PATCH',
    path: '/api/v1/practitioners/me',
    permission: 'practitioner.profile.write',
    scopeType: 'SELF',
  },
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
  // Records the identity or registration from what the practitioner submitted
  // and decides the submission in the same act.
  {
    method: 'POST',
    path: '/api/v1/practitioners/verification/confirm',
    permission: 'credential.review',
    scopeType: 'PLATFORM',
  },
  {
    method: 'GET',
    path: '/api/v1/practitioners/screening',
    permission: 'credential.review',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/practitioners/screening',
    permission: 'credential.review',
    scopeType: 'PLATFORM',
  },
  { method: 'GET', path: '/api/v1/sanctions', permission: 'credential.review', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/sanctions', permission: 'credential.review', scopeType: 'PLATFORM' },
  {
    method: 'POST',
    path: '/api/v1/sanctions/:id/remove',
    permission: 'credential.review',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/practitioners/me/photo-upload-url',
    permission: 'practitioner.profile.write',
    scopeType: 'SELF',
  },
  {
    method: 'POST',
    path: '/api/v1/practitioners/me/photo-url',
    permission: 'practitioner.profile.read',
    scopeType: 'SELF',
  },
  {
    method: 'POST',
    path: '/api/v1/practitioners/me/submit',
    permission: 'practitioner.profile.write',
    scopeType: 'SELF',
  },
  // Lives under /users because it answers "who is this number", but it is
  // listed here because this module's workflow is the only thing that needs
  // it: an officer cannot record an identity against somebody they cannot
  // find. Reuses the auth module's lookup behind a permission compliance
  // actually holds.
  {
    method: 'GET',
    path: '/api/v1/users/find',
    permission: 'user.read',
    scopeType: 'PLATFORM',
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
