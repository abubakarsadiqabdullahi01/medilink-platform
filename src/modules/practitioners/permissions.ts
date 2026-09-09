// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones practitioners uses.
import type { Permission } from '@/lib/authz/permissions';

export const MODULE_PERMISSIONS: Permission[] = ['practitioner.profile.read', 'practitioner.profile.write'];
