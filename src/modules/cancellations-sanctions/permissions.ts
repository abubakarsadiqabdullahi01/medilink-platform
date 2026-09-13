// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones it uses.
import type { Permission } from '@/lib/authz/permissions';

/**
 * No new keys were added to the catalogue for step 7.8. Requesting an excusal
 * is `attendance.record` at SELF — it is an assertion about your own
 * attendance at a shift, made by the person the record is about, which is the
 * same permission and the same scope as recording a check-in. Deciding one is
 * `sanction.apply`, because granting or refusing it is the decision that
 * determines whether a penalty follows.
 */
export const MODULE_PERMISSIONS: Permission[] = ['attendance.record', 'sanction.apply'];
