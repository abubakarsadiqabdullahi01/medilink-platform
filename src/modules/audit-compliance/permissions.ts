// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones audit compliance uses.
import type { Permission } from '@/lib/authz/permissions';

export const MODULE_PERMISSIONS: Permission[] = ['audit.read'];
