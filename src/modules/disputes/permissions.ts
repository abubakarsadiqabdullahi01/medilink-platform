// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones disputes uses.
import type { Permission } from '@/lib/authz/permissions';

/**
 * One key, three scopes, and the scope is what separates the roles.
 *
 * `dispute.manage` is held by practitioners, facility owners and operations
 * officers alike, so the permission alone cannot tell "complain about my own
 * shift" from "adjudicate somebody else's". The grant's scope does: a party
 * raises at SELF or FACILITY, an adjudicator works at PLATFORM. This is
 * exactly the case Section 8.8's permission-plus-scope rule exists for, and
 * why no new key was added.
 */
export const MODULE_PERMISSIONS: Permission[] = ['dispute.manage'];
