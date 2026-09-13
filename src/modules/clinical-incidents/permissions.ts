// Permissions this module enforces. Keys are defined centrally in
// src/lib/authz/permissions.ts; this file records which ones it uses.
import type { Permission } from '@/lib/authz/permissions';

/**
 * `incident.report` at FACILITY, `incident.manage` at PLATFORM.
 *
 * A facility reports what happened on its own floor and can read its own
 * reports back; it does not decide the outcome, because a facility judging an
 * incident that reflects on its own staffing is not a finding anyone should
 * rely on — the same reasoning that puts fault determination at PLATFORM.
 *
 * `user.suspend` is deliberately *not* here. The specification defines
 * `incident.manage` as "Manage a clinical incident, including suspension", so
 * suspension arising from a case is authorised by the case. Suspending
 * somebody with no case attached is a different act and is not exposed here.
 */
export const MODULE_PERMISSIONS: Permission[] = ['incident.report', 'incident.manage'];
