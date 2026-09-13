// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones attendance uses.
import type { Permission } from '@/lib/authz/permissions';

export const MODULE_PERMISSIONS: Permission[] = ['attendance.record', 'service_request.read'];
