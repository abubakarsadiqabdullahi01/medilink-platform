// Route table for credentials. Each entry names the permission and the scope
// type it is checked against, so authorisation is reviewable in one place.
import type { Permission } from '@/lib/authz/permissions';
import type { ScopeType } from '@/lib/authz/guard';

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  permission: Permission;
  scopeType: ScopeType;
}

export const ROUTES: RouteDefinition[] = [
  { method: 'POST', path: '/api/v1/credentials', permission: 'credential.submit', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/credentials', permission: 'credential.document.read', scopeType: 'SELF' },
  { method: 'GET', path: '/api/v1/credentials', permission: 'credential.document.read', scopeType: 'PLATFORM' },
  {
    method: 'POST',
    path: '/api/v1/credentials/document-upload-url',
    permission: 'credential.submit',
    scopeType: 'SELF',
  },
  {
    method: 'PATCH',
    path: '/api/v1/credentials/:id',
    permission: 'credential.submit',
    scopeType: 'SELF',
  },
  {
    method: 'POST',
    path: '/api/v1/credentials/:id/review',
    permission: 'credential.review',
    scopeType: 'PLATFORM',
  },
  {
    method: 'POST',
    path: '/api/v1/credentials/:id/document-url',
    permission: 'credential.document.read',
    scopeType: 'SELF',
  },
  {
    method: 'POST',
    path: '/api/v1/credentials/:id/document-url',
    permission: 'credential.document.read',
    scopeType: 'PLATFORM',
  },
];
