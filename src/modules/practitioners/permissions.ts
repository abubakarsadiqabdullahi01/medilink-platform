// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones practitioners uses.
import type { Permission } from '@/lib/authz/permissions';

// credential.review appears here too: recording an identity or a licence
// status is credential review, done by the same officer under the same
// permission, and inventing a second one would split that in two.
export const MODULE_PERMISSIONS: Permission[] = [
  'practitioner.profile.read',
  'practitioner.profile.write',
  'credential.review',
];
