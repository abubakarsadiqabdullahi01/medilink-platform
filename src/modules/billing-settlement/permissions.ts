// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones billing uses.
import type { Permission } from '@/lib/authz/permissions';

/**
 * `invoice.read` is held by facilities *and* practitioners, at their own
 * scope: a practitioner is entitled to see what they earned, and a facility
 * what it owes. `payout.manage` is the platform's, because paying somebody is
 * Medilink moving its own money.
 */
export const MODULE_PERMISSIONS: Permission[] = ['invoice.read', 'payout.manage'];
