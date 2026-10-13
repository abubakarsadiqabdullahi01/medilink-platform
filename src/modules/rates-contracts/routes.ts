// Route table for rates and contracts.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  scopeType: ScopeType;
}

export const ROUTES: RouteDefinition[] = [
  { method: 'POST', path: '/api/v1/rate-cards', permission: 'facility.write', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/rate-cards', permission: 'facility.read', scopeType: 'FACILITY' },
  { method: 'GET', path: '/api/v1/holidays', permission: 'config.manage', scopeType: 'PLATFORM' },
  { method: 'POST', path: '/api/v1/holidays', permission: 'config.manage', scopeType: 'PLATFORM' },
  { method: 'DELETE', path: '/api/v1/holidays/:id', permission: 'config.manage', scopeType: 'PLATFORM' },
];
