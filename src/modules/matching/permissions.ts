// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones matching uses.
import type { Permission } from '@/lib/authz/permissions';

// Running a match puts names in front of a facility, so it sits with the
// permission to confirm one rather than with the permission to read requests.
export const MODULE_PERMISSIONS: Permission[] = ['assignment.confirm', 'service_request.read'];
