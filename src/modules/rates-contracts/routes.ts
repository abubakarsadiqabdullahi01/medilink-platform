// Route table for rates contracts. Each entry names the permission and the scope
// type it is checked against, so authorisation is reviewable in one place.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  scopeType: ScopeType;
}

export const ROUTES: RouteDefinition[] = [];
