// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones it uses.
import type { Permission } from '@/lib/authz/permissions';

/**
 * The only two keys this codebase adds to Section 8.8's catalogue.
 *
 * No existing key fits. Submitting a suggestion is something every signed-in
 * user should be able to do, and there is deliberately no "any authenticated
 * user" permission — the guard requires a permission and a scope for
 * everything, which is the property that makes the route table reviewable.
 * Reusing an unrelated key to avoid the addition would have made the table
 * lie about what it authorises.
 */
export const MODULE_PERMISSIONS: Permission[] = ['suggestion.submit', 'suggestion.triage'];
