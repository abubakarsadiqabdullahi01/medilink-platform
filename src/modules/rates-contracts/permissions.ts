// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones rates uses.
import type { Permission } from '@/lib/authz/permissions';

/**
 * A rate card is what a facility agrees to pay above the base rate, so
 * setting one is `facility.write` at `FACILITY` scope — the same permission
 * that edits the facility itself. Reading it needs only `facility.read`,
 * because a practitioner offered a shift is entitled to know what the night
 * rate is before accepting.
 */
export const MODULE_PERMISSIONS: Permission[] = ['facility.write', 'facility.read', 'config.manage'];
