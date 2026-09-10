// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones facilities uses.
import type { Permission } from '@/lib/authz/permissions';

// facility.user.manage is deliberately absent: staff management is not in
// this cut. The representative holds facility_owner, which already carries
// service_request.publish, so Stage 6 is unblocked without it.
export const MODULE_PERMISSIONS: Permission[] = ['facility.read', 'facility.write', 'facility.verify'];
