// Route table for the suggestion log.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  scopeType: ScopeType;
}

/**
 * Submitting is SELF — it is your own account speaking. Reading the log and
 * triaging it are PLATFORM, because the log is the platform's to answer and
 * a facility reading every practitioner's complaints about it is not what
 * anybody agreed to.
 */
export const ROUTES: RouteDefinition[] = [
  { method: 'POST', path: '/api/v1/suggestions', permission: 'suggestion.submit', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/suggestions', permission: 'suggestion.triage', scopeType: 'PLATFORM' },
  { method: 'GET', path: '/api/v1/suggestions/summary', permission: 'suggestion.triage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/suggestions/:id/triage', permission: 'suggestion.triage', scopeType: 'PLATFORM' },
];
